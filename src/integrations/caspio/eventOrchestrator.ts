import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  fetchAllResidentData,
  resolveAlisCredentials,
  type AllResidentData,
} from '../alisClient.js';
import type { AlisEvent } from '../../webhook/schemas.js';
import type { AlisPayload } from '../alis/types.js';

import {
  findByPatientNumber,
  findRecordByFields,
  upsertByFields,
  updateRecordById,
} from './caspioClient.js';
import { getCommunityEnrichment } from './caspioCommunityEnrichment.js';
import type { CarePatientTableApiRecord } from './caspioMapper.js';
import {
  mapPatientRecord,
  mapServiceRecord,
  redactForLogs,
} from './caspioMapper.js';

/**
 * Extract numeric value from object with fallback keys
 */
function extractNumericValue(
  payload: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

/**
 * Extract residentId from event NotificationData
 */
function extractResidentId(event: AlisEvent): number {
  const residentId = extractNumericValue(event.NotificationData, ['ResidentId', 'residentId']);

  if (residentId !== undefined) {
    return residentId;
  }

  throw new Error('ResidentId is required in NotificationData');
}

function selectValidDateString(params: {
  primary: unknown;
  fallback: string | undefined;
  eventType: string;
  eventMessageId: string | number;
  residentId: number;
  communityId: number;
  leaveId?: number;
  fieldName: string;
}): string | undefined {
  const {
    primary,
    fallback,
    eventType,
    eventMessageId,
    residentId,
    communityId,
    leaveId,
    fieldName,
  } = params;

  const primaryString =
    typeof primary === 'string' && primary.trim().length > 0 ? primary : undefined;
  const fallbackString =
    typeof fallback === 'string' && fallback.trim().length > 0 ? fallback : undefined;
  const selected = primaryString ?? fallbackString;

  if (!selected) {
    logger.warn(
      {
        eventMessageId,
        eventType,
        residentId,
        communityId,
        leaveId,
        fieldName,
      },
      'leave_event_missing_date',
    );
    return undefined;
  }

  const parsed = new Date(selected);
  if (Number.isNaN(parsed.getTime())) {
    logger.warn(
      {
        eventMessageId,
        eventType,
        residentId,
        communityId,
        leaveId,
        fieldName,
        dateValue: selected,
      },
      'leave_event_invalid_date',
    );
    return undefined;
  }

  return selected;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

async function applyCommunityEnrichment(
  communityId: number,
  roomNumber: string | undefined,
): Promise<{ CUID?: string; CommunityName?: string }> {
  try {
    const enrichment = await getCommunityEnrichment(communityId, roomNumber);
    return {
      CUID: enrichment.CUID,
      CommunityName: enrichment.CommunityName,
    };
  } catch (error) {
    logger.warn(
      {
        communityId,
        hasRoomNumber: Boolean(roomNumber),
        error: error instanceof Error ? error.message : String(error),
      },
      'caspio_community_enrichment_failed',
    );
    return {};
  }
}

async function fetchFullResidentDataIfNeeded(
  companyId: number,
  companyKey: string,
  residentId: number,
  communityId: number | null,
  existing?: AllResidentData | null,
): Promise<AllResidentData> {
  if (existing) {
    return existing;
  }

  const credentials = await resolveAlisCredentials(companyId, companyKey);
  return fetchAllResidentData(credentials, residentId, communityId);
}

/**
 * Build AlisPayload from fetched resident data for mapper reuse.
 */
function buildAlisPayload(
  residentId: number,
  event: AlisEvent,
  fullResidentData: AllResidentData,
): AlisPayload {
  return {
    success: true,
    residentId,
    timestamp: event.EventMessageDate,
    apiBase: '',
    data: {
      resident: fullResidentData.resident,
      basicInfo: fullResidentData.basicInfo,
      insurance: fullResidentData.insurance,
      roomAssignments: fullResidentData.roomAssignments,
      diagnosesAndAllergies: fullResidentData.diagnosesAndAllergies,
      diagnosesAndAllergiesFull: fullResidentData.diagnosesAndAllergiesFull ?? null,
      contacts: fullResidentData.contacts,
      community: fullResidentData.community ?? null,
    },
    counts: {
      insurance: fullResidentData.insurance.length,
      roomAssignments: fullResidentData.roomAssignments.length,
      diagnosesAndAllergies: fullResidentData.diagnosesAndAllergies.length,
      contacts: fullResidentData.contacts.length,
    },
  };
}

async function findExistingPatient(
  patientNumber: string,
  cuid?: string,
): Promise<{ found: boolean; id?: string; record?: CarePatientTableApiRecord }> {
  if (cuid) {
    const match = await findRecordByFields(env.CASPIO_TABLE_NAME, [
      { field: 'PatientNumber', value: patientNumber },
      { field: 'CUID', value: cuid },
    ]);
    if (match.found) {
      return { found: true, id: match.id, record: match.record as CarePatientTableApiRecord };
    }
  }

  const fallback = await findByPatientNumber(env.CASPIO_TABLE_NAME, patientNumber);
  return {
    found: fallback.found,
    id: fallback.id,
    record: fallback.raw as CarePatientTableApiRecord | undefined,
  };
}

async function upsertServiceFromPatient(params: {
  patient: CarePatientTableApiRecord;
  serviceType?: string;
}): Promise<void> {
  if (!params.patient.PatientNumber) return;

  const serviceRecord = mapServiceRecord({
    patientNumber: params.patient.PatientNumber,
    cuid: params.patient.CUID,
    serviceType: params.serviceType,
    startDate: params.patient.Service_Start_Date ?? params.patient.Move_in_Date,
    endDate: params.patient.Service_End_Date,
    communityName: params.patient.CommunityName,
  });

  await upsertByFields(
    env.CASPIO_SERVICE_TABLE_NAME,
    [{ field: 'Service_ID', value: serviceRecord.Service_ID }],
    serviceRecord,
  );
}

/**
 * Handle move-in event
 */
async function handleMoveInEvent(
  event: AlisEvent,
  companyId: number,
  companyKey: string,
  residentId: number,
  communityId: number,
): Promise<void> {
  logger.info(
    { eventMessageId: event.EventMessageId, residentId, communityId },
    'handling_move_in_event',
  );

  const fullResidentData = await fetchFullResidentDataIfNeeded(
    companyId,
    companyKey,
    residentId,
    communityId,
  );

  const payload = buildAlisPayload(residentId, event, fullResidentData);
  const communityContext = await applyCommunityEnrichment(communityId, undefined);
  const patientRecord = mapPatientRecord(payload, communityContext);
  patientRecord.PatientNumber = String(residentId);
  if (!patientRecord.Service_Start_Date) {
    patientRecord.Service_Start_Date = patientRecord.Move_in_Date ?? getTodayDateString();
  }

  const result = await upsertByFields(
    env.CASPIO_TABLE_NAME,
    patientRecord.CUID
      ? [
          { field: 'PatientNumber', value: patientRecord.PatientNumber },
          { field: 'CUID', value: patientRecord.CUID },
        ]
      : [{ field: 'PatientNumber', value: patientRecord.PatientNumber }],
    patientRecord as Record<string, unknown>,
  );

  const resident = fullResidentData.resident as Record<string, unknown>;
  const serviceType =
    (typeof resident.Classification === 'string' && resident.Classification) ||
    (typeof resident.ProductType === 'string' && resident.ProductType) ||
    undefined;
  await upsertServiceFromPatient({ patient: patientRecord, serviceType });

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      action: result.action,
      caspioId: result.id,
    },
    'move_in_event_upserted_patient_and_service',
  );
}

/**
 * Handle move-out event
 */
async function handleMoveOutEvent(
  event: AlisEvent,
  companyId: number,
  companyKey: string,
  residentId: number,
  communityId: number,
): Promise<void> {
  logger.info(
    { eventMessageId: event.EventMessageId, residentId, communityId },
    'handling_move_out_event',
  );

  const communityContext = await applyCommunityEnrichment(communityId, undefined);
  const existing = await findExistingPatient(String(residentId), communityContext.CUID);

  if (!existing.found || !existing.id) {
    logger.warn(
      {
        eventMessageId: event.EventMessageId,
        residentId,
        communityId,
      },
      'move_out_event_resident_not_found_skipping',
    );
    return;
  }

  const updateData: Partial<CarePatientTableApiRecord> = {
    PatientNumber: String(residentId),
    CUID: communityContext.CUID,
    CommunityName: communityContext.CommunityName,
  };

  if (!existing.record?.Move_Out_Date) {
    updateData.Move_Out_Date = getTodayDateString();
  }

  if (!existing.record?.Service_End_Date) {
    updateData.Service_End_Date = getTodayDateString();
  }

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, updateData);

  const fullResidentData = await fetchFullResidentDataIfNeeded(
    companyId,
    companyKey,
    residentId,
    communityId,
  );
  const resident = fullResidentData.resident as Record<string, unknown>;
  const serviceType =
    (typeof resident.Classification === 'string' && resident.Classification) ||
    (typeof resident.ProductType === 'string' && resident.ProductType) ||
    undefined;

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      caspioId: existing.id,
    },
    'move_out_event_updated_patient_record',
  );

  await upsertServiceFromPatient({
    patient: {
      ...existing.record,
      ...updateData,
    },
    serviceType,
  });
}

/**
 * Handle other update events (basic_info_updated, created, contact.updated, etc.)
 */
async function handleUpdateEvent(
  event: AlisEvent,
  companyId: number,
  companyKey: string,
  residentId: number,
  communityId: number,
): Promise<void> {
  logger.info(
    { eventMessageId: event.EventMessageId, residentId, communityId, eventType: event.EventType },
    'handling_update_event',
  );

  const communityContext = await applyCommunityEnrichment(communityId, undefined);
  const existing = await findExistingPatient(String(residentId), communityContext.CUID);

  if (!existing.found || !existing.id) {
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        residentId,
        communityId,
        eventType: event.EventType,
      },
      'update_event_resident_not_found_ignoring',
    );
    return;
  }

  const fullResidentData = await fetchFullResidentDataIfNeeded(
    companyId,
    companyKey,
    residentId,
    communityId,
  );

  const payload = buildAlisPayload(residentId, event, fullResidentData);
  const patientRecord = mapPatientRecord(payload, communityContext);
  patientRecord.PatientNumber = String(residentId);
  const patchWithoutMoveIn =
    event.EventType === 'residents.move_in_out_info_updated'
      ? patientRecord
      : (({ Move_in_Date, ...rest }) => rest)(patientRecord);

  logger.debug(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      caspioId: existing.id,
      patchKeys: Object.keys(patchWithoutMoveIn),
    },
    'update_event_applying_patch',
  );

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, patchWithoutMoveIn);

  const resident = fullResidentData.resident as Record<string, unknown>;
  const serviceType =
    (typeof resident.Classification === 'string' && resident.Classification) ||
    (typeof resident.ProductType === 'string' && resident.ProductType) ||
    undefined;
  await upsertServiceFromPatient({ patient: patientRecord, serviceType });

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      caspioId: existing.id,
      eventType: event.EventType,
    },
    'update_event_applied_patch',
  );
}

/**
 * Handle leave start event
 */
async function handleLeaveStartEvent(
  event: AlisEvent,
  communityId: number,
): Promise<void> {
  const notificationData = event.NotificationData || {};
  const residentId = extractNumericValue(notificationData, ['ResidentId', 'residentId']);
  const leaveId = extractNumericValue(notificationData, ['LeaveId', 'leaveId']);

  if (!residentId) {
    logger.warn(
      {
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        communityId,
        leaveId,
      },
      'leave_event_missing_resident_id',
    );
    return;
  }

  const leaveStartDate = selectValidDateString({
    primary: (notificationData as Record<string, unknown>).StartDateTime,
    fallback: event.EventMessageDate,
    eventType: event.EventType,
    eventMessageId: event.EventMessageId,
    residentId,
    communityId,
    leaveId,
    fieldName: 'StartDateTime',
  });

  if (!leaveStartDate) {
    return;
  }

  const communityContext = await applyCommunityEnrichment(communityId, undefined);
  const existing = await findExistingPatient(String(residentId), communityContext.CUID);
  if (!existing.found || !existing.id) {
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        residentId,
        communityId,
        leaveId,
      },
      'leave_event_resident_not_found_ignoring',
    );
    return;
  }

  const patch: Partial<CarePatientTableApiRecord> = {
    Off_Prem: true,
    Off_Prem_Date: leaveStartDate,
    On_Prem: false,
  };

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, patch);

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      residentId,
      communityId,
      leaveId,
      caspioId: existing.id,
      patchKeys: Object.keys(patch),
    },
    'leave_start_event_applied_patch',
  );
}

/**
 * Handle leave end event
 */
async function handleLeaveEndEvent(
  event: AlisEvent,
  communityId: number,
): Promise<void> {
  const notificationData = event.NotificationData || {};
  const residentId = extractNumericValue(notificationData, ['ResidentId', 'residentId']);
  const leaveId = extractNumericValue(notificationData, ['LeaveId', 'leaveId']);

  if (!residentId) {
    logger.warn(
      {
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        communityId,
        leaveId,
      },
      'leave_event_missing_resident_id',
    );
    return;
  }

  const leaveEndDate = selectValidDateString({
    primary: (notificationData as Record<string, unknown>).EndDateTime,
    fallback: event.EventMessageDate,
    eventType: event.EventType,
    eventMessageId: event.EventMessageId,
    residentId,
    communityId,
    leaveId,
    fieldName: 'EndDateTime',
  });

  if (!leaveEndDate) {
    return;
  }

  const communityContext = await applyCommunityEnrichment(communityId, undefined);
  const existing = await findExistingPatient(String(residentId), communityContext.CUID);
  if (!existing.found || !existing.id) {
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        residentId,
        communityId,
        leaveId,
      },
      'leave_event_resident_not_found_ignoring',
    );
    return;
  }

  const patch: Partial<CarePatientTableApiRecord> = {
    On_Prem: true,
    On_Prem_Date: leaveEndDate,
    Off_Prem: false,
  };

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, patch);

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      residentId,
      communityId,
      leaveId,
      caspioId: existing.id,
      patchKeys: Object.keys(patch),
    },
    'leave_end_event_applied_patch',
  );
}

/**
 * Main event handler - routes events by EventType
 */
export async function handleAlisEvent(
  event: AlisEvent,
  companyId: number,
  companyKey: string,
): Promise<void> {
  const eventMessageId = event.EventMessageId;
  const eventType = event.EventType;

  logger.info(
    { eventMessageId, eventType, companyKey },
    'handle_alis_event_start',
  );

  try {
    const communityId = event.CommunityId;

    if (!communityId) {
      logger.warn(
        { eventMessageId, eventType },
        'event_missing_community_id_skipping',
      );
      return;
    }

    // Route by event type
    switch (eventType) {
      case 'residents.move_in':
        {
          const residentId = extractResidentId(event);
          await handleMoveInEvent(event, companyId, companyKey, residentId, communityId);
        }
        break;

      case 'residents.leave_start':
        await handleLeaveStartEvent(event, communityId);
        break;

      case 'residents.leave_end':
        await handleLeaveEndEvent(event, communityId);
        break;

      case 'residents.move_out':
        {
          const residentId = extractResidentId(event);
          await handleMoveOutEvent(event, companyId, companyKey, residentId, communityId);
        }
        break;

      default:
        {
          const residentId = extractResidentId(event);
          // All other event types (basic_info_updated, created, contact.updated, etc.)
          await handleUpdateEvent(event, companyId, companyKey, residentId, communityId);
        }
        break;
    }

    logger.info(
      { eventMessageId, eventType },
      'handle_alis_event_completed',
    );
  } catch (error) {
    logger.error(
      {
        eventMessageId,
        eventType,
        error: error instanceof Error ? error.message : String(error),
        event: redactForLogs(event),
      },
      'handle_alis_event_failed',
    );
    throw error;
  }
}

