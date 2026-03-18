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
  findActiveOrLatestServiceRow,
  findOpenOffPremEpisode,
  findByPatientNumber,
  findCommunityByIdAndRoomNumber,
  findRecordByFields,
  upsertOffPremEpisodeByEpisodeId,
  upsertByFields,
  updateRecordById,
} from './caspioClient.js';
import { getCommunityEnrichment } from './caspioCommunityEnrichment.js';
import type { CarePatientTableApiRecord } from './caspioMapper.js';
import {
  mapOffPremEndPatch,
  mapOffPremStartEpisode,
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

function extractStringValue(
  payload: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
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

function extractRoomNumber(event: AlisEvent): string | undefined {
  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  if (!notificationData) return undefined;

  const direct = extractStringValue(notificationData, [
    'RoomNumber',
    'roomNumber',
    'Room',
    'room',
    'AssignedRoom',
    'assignedRoom',
    'ApartmentNumber',
    'apartmentNumber',
  ]);
  if (direct) return direct;

  const roomsAssigned = notificationData.RoomsAssigned;
  if (Array.isArray(roomsAssigned)) {
    for (const item of roomsAssigned) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const room = extractStringValue(record, ['RoomNumber', 'Room', 'roomNumber', 'room']);
      if (room) return room;
    }
  }

  const roomsUnassigned = notificationData.RoomsUnassigned;
  if (Array.isArray(roomsUnassigned)) {
    for (const item of roomsUnassigned) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const room = extractStringValue(record, ['RoomNumber', 'Room', 'roomNumber', 'room']);
      if (room) return room;
    }
  }

  return undefined;
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
    logger.info(
      {
        communityId,
        roomNumber: roomNumber ?? null,
        resolvedCuid: enrichment.CUID ?? null,
        resolvedCommunityName: enrichment.CommunityName ?? null,
      },
      'patient_community_context_resolved',
    );
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

function getClassification(
  event: AlisEvent,
  residentData?: Record<string, unknown>,
  basicInfoData?: Record<string, unknown>,
): string | undefined {
  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  return (
    extractStringValue(notificationData, ['Classification', 'classification', 'ServiceType', 'serviceType']) ??
    (residentData
      ? extractStringValue(residentData, ['Classification', 'classification', 'ProductType', 'productType'])
      : undefined) ??
    (basicInfoData
      ? extractStringValue(basicInfoData, ['Classification', 'classification', 'ProductType', 'productType'])
      : undefined)
  );
}

function normalizeScenarioDate(primary?: string, fallback?: string): string {
  const value = (primary && primary.trim().length > 0 ? primary : undefined) ?? fallback ?? getTodayDateString();
  return value;
}

function isOpenServiceRow(endDate: unknown): boolean {
  return endDate === undefined || endDate === null || (typeof endDate === 'string' && endDate.trim().length === 0);
}

async function resolveServiceCommunityContext(params: {
  event: AlisEvent;
  residentId: number;
  communityId: number;
  fallbackRoomNumber?: string;
}): Promise<{ matched: boolean; cuid?: string; communityName?: string }> {
  const roomNumber = extractRoomNumber(params.event) ?? params.fallbackRoomNumber;
  if (!roomNumber) {
    logger.warn(
      {
        eventMessageId: params.event.EventMessageId,
        eventType: params.event.EventType,
        residentId: params.residentId,
        communityId: params.communityId,
      },
      'service_write_skipped_missing_room_number',
    );
    return { matched: false };
  }

  const communityMatch = await findCommunityByIdAndRoomNumber(params.communityId, roomNumber);
  if (!communityMatch.found || !communityMatch.record) {
    logger.warn(
      {
        eventMessageId: params.event.EventMessageId,
        eventType: params.event.EventType,
        residentId: params.residentId,
        communityId: params.communityId,
        roomNumber,
      },
      'service_write_skipped_community_room_not_found',
    );
    return { matched: false };
  }

  const cuid =
    typeof communityMatch.record.CUID === 'string' && communityMatch.record.CUID.trim().length > 0
      ? communityMatch.record.CUID.trim()
      : undefined;
  const communityName =
    typeof communityMatch.record.CommunityName === 'string' && communityMatch.record.CommunityName.trim().length > 0
      ? communityMatch.record.CommunityName.trim()
      : undefined;

  if (!cuid) {
    logger.warn(
      {
        eventMessageId: params.event.EventMessageId,
        eventType: params.event.EventType,
        residentId: params.residentId,
        communityId: params.communityId,
        roomNumber,
      },
      'service_write_skipped_missing_cuid',
    );
    return { matched: false };
  }

  logger.info(
    {
      eventMessageId: params.event.EventMessageId,
      eventType: params.event.EventType,
      residentId: params.residentId,
      communityId: params.communityId,
      roomNumber,
      resolvedCuid: cuid,
      resolvedCommunityName: communityName ?? null,
    },
    'service_community_context_resolved',
  );

  return { matched: true, cuid, communityName };
}

async function createServiceRow(params: {
  patientNumber: string;
  cuid: string;
  communityName?: string;
  serviceType?: string;
  startDate: string;
  endDate?: string;
}): Promise<void> {
  const serviceRecord = mapServiceRecord({
    patientNumber: params.patientNumber,
    cuid: params.cuid,
    communityName: params.communityName,
    serviceType: params.serviceType,
    startDate: params.startDate,
    endDate: params.endDate,
  });
  const { Service_ID, ...serviceRecordForWrite } = serviceRecord;
  const filters: Array<{ field: string; value: string | number | boolean }> = [
    { field: 'PatientNumber', value: params.patientNumber },
    { field: 'CUID', value: params.cuid },
    { field: 'StartDate', value: params.startDate },
  ];
  if (params.serviceType) {
    filters.push({ field: 'ServiceType', value: params.serviceType });
  }

  await upsertByFields(
    env.CASPIO_SERVICE_TABLE_NAME,
    filters,
    serviceRecordForWrite as Record<string, unknown>,
  );
}

async function closeLatestServiceRow(params: {
  patientNumber: string;
  cuid: string;
  endDate: string;
}): Promise<void> {
  const serviceRow = await findActiveOrLatestServiceRow({
    patientNumber: params.patientNumber,
    cuid: params.cuid,
  });

  if (!serviceRow.found || !serviceRow.id) {
    logger.warn(
      {
        patientNumber: params.patientNumber,
        cuid: params.cuid,
      },
      'service_close_skipped_no_existing_row',
    );
    return;
  }

  if (serviceRow.record?.EndDate === params.endDate) {
    return;
  }

  await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, serviceRow.id, { EndDate: params.endDate });
}

async function closeOpenOffPremEpisode(params: {
  patientNumber: string;
  cuid?: string;
  leaveId?: number;
  offPremEnd: string;
  endEventMessageId: string | number;
  closeReason: 'leave_end' | 'move_out';
}): Promise<void> {
  const openEpisode = await findOpenOffPremEpisode({
    patientNumber: params.patientNumber,
    cuid: params.cuid,
    leaveId: params.leaveId,
  });

  if (!openEpisode.found || !openEpisode.id || !openEpisode.record?.OffPremStart) {
    logger.warn(
      {
        patientNumber: params.patientNumber,
        cuid: params.cuid,
        leaveId: params.leaveId,
      },
      'off_prem_open_episode_not_found',
    );
    return;
  }

  const closePatch = mapOffPremEndPatch({
    offPremStart: String(openEpisode.record.OffPremStart),
    offPremEnd: params.offPremEnd,
    endEventMessageId: params.endEventMessageId,
    closeReason: params.closeReason,
  });
  await updateRecordById(env.CASPIO_OFF_PREM_HISTORY_TABLE_NAME, openEpisode.id, closePatch);
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
  const roomNumber = extractRoomNumber(event);
  const communityContext = await applyCommunityEnrichment(communityId, roomNumber);
  const patientRecord = mapPatientRecord(payload, communityContext);
  patientRecord.PatientNumber = String(residentId);
  if (!patientRecord.ApartmentNumber && roomNumber) {
    patientRecord.ApartmentNumber = roomNumber;
  }
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
  const basicInfo = fullResidentData.basicInfo as Record<string, unknown>;
  const serviceType = getClassification(event, resident, basicInfo);
  const serviceCommunity = await resolveServiceCommunityContext({
    event,
    residentId,
    communityId,
  });
  if (serviceCommunity.matched && serviceCommunity.cuid) {
    await createServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
      communityName: serviceCommunity.communityName,
      serviceType,
      startDate: normalizeScenarioDate(patientRecord.Move_in_Date, event.EventMessageDate),
    });
  }

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

  const roomNumber = extractRoomNumber(event);
  const communityContext = await applyCommunityEnrichment(communityId, roomNumber);
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

  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  const moveOutDate = normalizeScenarioDate(
    extractStringValue(notificationData, ['PhysicalMoveOutDate', 'MoveOutDate', 'MoveOutDateTime']),
    event.EventMessageDate,
  );

  const updateData: Partial<CarePatientTableApiRecord> = {
    PatientNumber: String(residentId),
    CUID: communityContext.CUID,
    CommunityName: communityContext.CommunityName,
  };

  if (!existing.record?.Move_Out_Date) {
    updateData.Move_Out_Date = moveOutDate;
  }

  if (!existing.record?.Service_End_Date) {
    updateData.Service_End_Date = moveOutDate;
  }

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, updateData);

  await fetchFullResidentDataIfNeeded(
    companyId,
    companyKey,
    residentId,
    communityId,
  );

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      caspioId: existing.id,
    },
    'move_out_event_updated_patient_record',
  );

  const serviceCommunity = await resolveServiceCommunityContext({
    event,
    residentId,
    communityId,
    fallbackRoomNumber:
      typeof existing.record?.ApartmentNumber === 'string'
        ? existing.record.ApartmentNumber
        : undefined,
  });
  if (serviceCommunity.matched && serviceCommunity.cuid) {
    await closeLatestServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
      endDate: moveOutDate,
    });
  }

  await closeOpenOffPremEpisode({
    patientNumber: String(residentId),
    cuid: communityContext.CUID,
    offPremEnd: moveOutDate,
    endEventMessageId: event.EventMessageId,
    closeReason: 'move_out',
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

  const roomNumber = extractRoomNumber(event);
  const communityContext = await applyCommunityEnrichment(communityId, roomNumber);
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
  if (!patientRecord.ApartmentNumber && roomNumber) {
    patientRecord.ApartmentNumber = roomNumber;
  }
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
  const basicInfo = fullResidentData.basicInfo as Record<string, unknown>;
  const incomingServiceType = getClassification(event, resident, basicInfo);
  const serviceRoomFallback =
    (typeof patientRecord.ApartmentNumber === 'string' && patientRecord.ApartmentNumber.trim().length > 0
      ? patientRecord.ApartmentNumber.trim()
      : undefined) ??
    (typeof existing.record?.ApartmentNumber === 'string' && existing.record.ApartmentNumber.trim().length > 0
      ? existing.record.ApartmentNumber.trim()
      : undefined);
  const serviceCommunity = await resolveServiceCommunityContext({
    event,
    residentId,
    communityId,
    fallbackRoomNumber: serviceRoomFallback,
  });
  if (serviceCommunity.matched && serviceCommunity.cuid && incomingServiceType) {
    const boundaryDate = normalizeScenarioDate(event.EventMessageDate);
    const existingService = await findActiveOrLatestServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
    });

    if (!existingService.found || !existingService.id || !existingService.record) {
      await createServiceRow({
        patientNumber: String(residentId),
        cuid: serviceCommunity.cuid,
        communityName: serviceCommunity.communityName,
        serviceType: incomingServiceType,
        startDate: boundaryDate,
      });
    } else {
      const currentServiceType =
        typeof existingService.record.ServiceType === 'string'
          ? existingService.record.ServiceType
          : undefined;
      const active = isOpenServiceRow(existingService.record.EndDate);
      const hasChanged = !currentServiceType || currentServiceType !== incomingServiceType;

      if (active && hasChanged) {
        await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, existingService.id, {
          EndDate: boundaryDate,
        });
        await createServiceRow({
          patientNumber: String(residentId),
          cuid: serviceCommunity.cuid,
          communityName: serviceCommunity.communityName,
          serviceType: incomingServiceType,
          startDate: boundaryDate,
        });
      } else if (!active) {
        await createServiceRow({
          patientNumber: String(residentId),
          cuid: serviceCommunity.cuid,
          communityName: serviceCommunity.communityName,
          serviceType: incomingServiceType,
          startDate: boundaryDate,
        });
      }
    }
  }

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

  const offPremEpisode = mapOffPremStartEpisode({
    patientNumber: String(residentId),
    cuid: communityContext.CUID,
    communityName: communityContext.CommunityName,
    leaveId,
    offPremStart: leaveStartDate,
    startEventMessageId: event.EventMessageId,
  });
  await upsertOffPremEpisodeByEpisodeId(offPremEpisode);

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

  await closeOpenOffPremEpisode({
    patientNumber: String(residentId),
    cuid: communityContext.CUID,
    leaveId,
    offPremEnd: leaveEndDate,
    endEventMessageId: event.EventMessageId,
    closeReason: 'leave_end',
  });

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

