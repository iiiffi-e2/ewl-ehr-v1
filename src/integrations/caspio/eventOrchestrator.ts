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
import {
  POST_MOVE_OUT_RESIDENT_SERVICE_TYPE,
  ROOM_VACANCY_SERVICE_TYPE,
} from './serviceLineTypes.js';

/** Prefer NotificationData room over stale API data for these event types. */
const ROOM_NOTIFICATION_PRIORITY_EVENT_TYPES = new Set([
  'resident.room_assigned',
  'residents.move_in_out_info_updated',
]);

function trimNonEmpty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function hasMeaningfulCaspioDate(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return true;
}

function isPatientRecordMovedOut(record?: CarePatientTableApiRecord): boolean {
  if (!record) return false;
  return (
    hasMeaningfulCaspioDate(record.Move_Out_Date) || hasMeaningfulCaspioDate(record.Service_End_Date)
  );
}

function stripPremFieldsFromPatch(patch: Partial<CarePatientTableApiRecord>): void {
  delete patch.On_Prem;
  delete patch.Off_Prem;
  delete patch.On_Prem_Date;
  delete patch.Off_Prem_Date;
}

function applyPreferredApartmentFromEvent(
  event: AlisEvent,
  patientRecord: CarePatientTableApiRecord,
  roomNumber: string | undefined,
): void {
  if (roomNumber && ROOM_NOTIFICATION_PRIORITY_EVENT_TYPES.has(event.EventType)) {
    patientRecord.ApartmentNumber = roomNumber;
    return;
  }
  if (!patientRecord.ApartmentNumber && roomNumber) {
    patientRecord.ApartmentNumber = roomNumber;
  }
}

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

function extractNestedStringValue(
  payload: unknown,
  keys: string[],
  depth = 0,
): string | undefined {
  if (!payload || depth > 3) return undefined;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extractNestedStringValue(item, keys, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  if (typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const direct = extractStringValue(record, keys);
  if (direct) return direct;

  for (const value of Object.values(record)) {
    const nested = extractNestedStringValue(value, keys, depth + 1);
    if (nested) return nested;
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
    'NewRoomNumber',
    'newRoomNumber',
    'ToRoomNumber',
    'toRoomNumber',
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
    extractNestedStringValue(notificationData, [
      'Classification',
      'classification',
      'ServiceType',
      'serviceType',
      'ProductType',
      'productType',
    ]) ??
    (residentData
      ? extractStringValue(residentData, ['Classification', 'classification', 'ProductType', 'productType'])
      : undefined) ??
    (basicInfoData
      ? extractStringValue(basicInfoData, ['Classification', 'classification', 'ProductType', 'productType'])
      : undefined)
  );
}

function normalizeServiceType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.toLowerCase();
}

function normalizeScenarioDate(primary?: string, fallback?: string): string {
  const value = (primary && primary.trim().length > 0 ? primary : undefined) ?? fallback ?? getTodayDateString();
  return value;
}

function formatCaspioDateTime(value?: string): string {
  const source = value && value.trim().length > 0 ? value : undefined;
  const parsed = source ? new Date(source) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}

function normalizeScenarioDateTime(primary?: string, fallback?: string): string {
  const value = (primary && primary.trim().length > 0 ? primary : undefined) ?? fallback;
  return formatCaspioDateTime(value);
}

function isDefaultEndDateValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return (
    normalized.startsWith('0001-01-01') ||
    normalized.startsWith('1900-01-01') ||
    normalized.startsWith('01/01/1900') ||
    normalized.startsWith('1/1/1900')
  );
}

function isOpenServiceRow(endDate: unknown): boolean {
  if (endDate === undefined || endDate === null) {
    return true;
  }
  if (typeof endDate === 'string') {
    if (isDefaultEndDateValue(endDate)) {
      return true;
    }
    const parsed = Date.parse(endDate);
    return Number.isNaN(parsed) ? false : new Date(parsed).getUTCFullYear() <= 1900;
  }
  if (endDate instanceof Date) {
    return Number.isNaN(endDate.getTime()) ? true : endDate.getUTCFullYear() <= 1900;
  }
  return false;
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
  patientNumber?: string;
  cuid: string;
  communityName?: string;
  serviceType?: string;
  startDate: string;
  endDate?: string;
  eventMessageId?: string | number;
  eventType?: string;
  residentId?: number;
  communityId?: number;
  source?: string;
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
    { field: 'CUID', value: params.cuid },
    { field: 'StartDate', value: params.startDate },
  ];
  if (params.patientNumber) {
    filters.push({ field: 'PatientNumber', value: params.patientNumber });
  }
  if (params.serviceType) {
    filters.push({ field: 'ServiceType', value: params.serviceType });
  }

  const result = await upsertByFields(
    env.CASPIO_SERVICE_TABLE_NAME,
    filters,
    serviceRecordForWrite as Record<string, unknown>,
  );
  logger.info(
    {
      eventMessageId: params.eventMessageId,
      eventType: params.eventType,
      residentId: params.residentId,
      communityId: params.communityId,
      source: params.source,
      patientNumber: params.patientNumber ?? null,
      cuid: params.cuid,
      serviceType: params.serviceType ?? null,
      startDate: params.startDate,
      endDate: params.endDate ?? null,
      action: result.action,
      caspioId: result.id ?? null,
    },
    'service_row_upserted',
  );
}

async function closeLatestServiceRow(params: {
  patientNumber: string;
  cuid: string;
  endDate: string;
  eventMessageId?: string | number;
  eventType?: string;
  residentId?: number;
  communityId?: number;
  source?: string;
}): Promise<void> {
  const serviceRow = await findActiveOrLatestServiceRow({
    patientNumber: params.patientNumber,
    cuid: params.cuid,
  });

  if (!serviceRow.found || !serviceRow.id) {
    logger.warn(
      {
        eventMessageId: params.eventMessageId,
        eventType: params.eventType,
        residentId: params.residentId,
        communityId: params.communityId,
        source: params.source,
        patientNumber: params.patientNumber,
        cuid: params.cuid,
      },
      'service_close_skipped_no_existing_row',
    );
    return;
  }

  logger.info(
    {
      eventMessageId: params.eventMessageId,
      eventType: params.eventType,
      residentId: params.residentId,
      communityId: params.communityId,
      source: params.source,
      serviceRowId: serviceRow.id,
      patientNumber: params.patientNumber,
      cuid: params.cuid,
      currentStartDate: serviceRow.record?.StartDate ?? null,
      currentEndDate: serviceRow.record?.EndDate ?? null,
      requestedEndDate: params.endDate,
    },
    'service_close_target_resolved',
  );

  if (serviceRow.record?.EndDate === params.endDate) {
    logger.info(
      {
        eventMessageId: params.eventMessageId,
        eventType: params.eventType,
        residentId: params.residentId,
        communityId: params.communityId,
        source: params.source,
        serviceRowId: serviceRow.id,
        requestedEndDate: params.endDate,
      },
      'service_close_skipped_same_end_date',
    );
    return;
  }

  await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, serviceRow.id, { EndDate: params.endDate });
  logger.info(
    {
      eventMessageId: params.eventMessageId,
      eventType: params.eventType,
      residentId: params.residentId,
      communityId: params.communityId,
      source: params.source,
      serviceRowId: serviceRow.id,
      patientNumber: params.patientNumber,
      cuid: params.cuid,
      endDate: params.endDate,
    },
    'service_row_closed',
  );
}

async function closeOpenOffPremEpisode(params: {
  patientNumber: string;
  cuid?: string;
  leaveId?: number;
  offPremEnd: string;
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
  if (roomNumber) {
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
    fallbackRoomNumber: trimNonEmpty(patientRecord.ApartmentNumber),
  });
  if (serviceCommunity.matched && serviceCommunity.cuid) {
    await createServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
      communityName: serviceCommunity.communityName,
      serviceType,
      startDate: normalizeScenarioDateTime(patientRecord.Move_in_Date, event.EventMessageDate),
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      residentId,
      communityId,
      source: 'move_in',
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
  const serviceBoundaryDate = formatCaspioDateTime();

  const updateData: Partial<CarePatientTableApiRecord> = {
    PatientNumber: String(residentId),
    CUID: communityContext.CUID,
    CommunityName: communityContext.CommunityName,
    On_Prem: false,
    Off_Prem: false,
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
      endDate: serviceBoundaryDate,
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      residentId,
      communityId,
      source: 'move_out',
    });
    await createServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
      communityName: serviceCommunity.communityName,
      serviceType: POST_MOVE_OUT_RESIDENT_SERVICE_TYPE,
      startDate: serviceBoundaryDate,
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      residentId,
      communityId,
      source: 'move_out_resident_post_exit',
    });
    await createServiceRow({
      cuid: serviceCommunity.cuid,
      communityName: serviceCommunity.communityName,
      serviceType: ROOM_VACANCY_SERVICE_TYPE,
      startDate: serviceBoundaryDate,
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      residentId,
      communityId,
      source: 'move_out_room_vacancy',
    });
  }

  await closeOpenOffPremEpisode({
    patientNumber: String(residentId),
    cuid: communityContext.CUID,
    offPremEnd: moveOutDate,
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
  let communityContext = await applyCommunityEnrichment(communityId, roomNumber);
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
  applyPreferredApartmentFromEvent(event, patientRecord, roomNumber);
  const effectiveRoom = trimNonEmpty(patientRecord.ApartmentNumber) ?? roomNumber;
  communityContext = await applyCommunityEnrichment(communityId, effectiveRoom);
  patientRecord.CUID = communityContext.CUID ?? patientRecord.CUID;
  patientRecord.CommunityName = communityContext.CommunityName ?? patientRecord.CommunityName;
  patientRecord.PatientNumber = String(residentId);
  const patchWithoutMoveIn =
    event.EventType === 'residents.move_in_out_info_updated'
      ? patientRecord
      : (({ Move_in_Date, ...rest }) => rest)(patientRecord);

  if (isPatientRecordMovedOut(existing.record)) {
    stripPremFieldsFromPatch(patchWithoutMoveIn);
  } else {
    const openEpisode = await findOpenOffPremEpisode({
      patientNumber: String(residentId),
      cuid: trimNonEmpty(patientRecord.CUID) ?? trimNonEmpty(existing.record?.CUID),
    });
    if (openEpisode.found) {
      stripPremFieldsFromPatch(patchWithoutMoveIn);
    }
  }

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
  let incomingServiceType = getClassification(event, resident, basicInfo);
  const serviceRoomFallback =
    trimNonEmpty(patientRecord.ApartmentNumber) ??
    trimNonEmpty(existing.record?.ApartmentNumber);
  const serviceCommunity = await resolveServiceCommunityContext({
    event,
    residentId,
    communityId,
    fallbackRoomNumber: serviceRoomFallback,
  });
  const skipServiceTransitions = isPatientRecordMovedOut(existing.record);
  if (skipServiceTransitions) {
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        residentId,
        communityId,
      },
      'update_event_service_skipped_patient_moved_out',
    );
  }
  if (!skipServiceTransitions && serviceCommunity.matched && serviceCommunity.cuid) {
    const boundaryDate = normalizeScenarioDateTime(event.EventMessageDate);
    const existingService = await findActiveOrLatestServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
    });

    const currentServiceType =
      existingService.found && existingService.record && typeof existingService.record.ServiceType === 'string'
        ? existingService.record.ServiceType
        : undefined;

    let hasChanged =
      !currentServiceType ||
      normalizeServiceType(currentServiceType) !== normalizeServiceType(incomingServiceType);

    if (
      event.EventType === 'residents.basic_info_updated' &&
      (!incomingServiceType || !hasChanged)
    ) {
      const refreshedResidentData = await fetchFullResidentDataIfNeeded(
        companyId,
        companyKey,
        residentId,
        communityId,
      );
      const refreshedResident = refreshedResidentData.resident as Record<string, unknown>;
      const refreshedBasicInfo = refreshedResidentData.basicInfo as Record<string, unknown>;
      const refreshedServiceType = getClassification(event, refreshedResident, refreshedBasicInfo);
      if (refreshedServiceType) {
        incomingServiceType = refreshedServiceType;
        hasChanged =
          !currentServiceType ||
          normalizeServiceType(currentServiceType) !== normalizeServiceType(incomingServiceType);
      }
    }

    if (!incomingServiceType) {
      logger.info(
        {
          eventMessageId: event.EventMessageId,
          eventType: event.EventType,
          residentId,
          communityId,
        },
        'service_write_skipped_missing_classification',
      );
    } else if (!existingService.found || !existingService.id || !existingService.record) {
      logger.info(
        {
          eventMessageId: event.EventMessageId,
          eventType: event.EventType,
          residentId,
          communityId,
          source: 'update_event',
          patientNumber: String(residentId),
          cuid: serviceCommunity.cuid,
          currentServiceType: currentServiceType ?? null,
          incomingServiceType,
          hasChanged,
          existingServiceFound: false,
        },
        'service_transition_evaluated',
      );
      await createServiceRow({
        patientNumber: String(residentId),
        cuid: serviceCommunity.cuid,
        communityName: serviceCommunity.communityName,
        serviceType: incomingServiceType,
        startDate: boundaryDate,
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        residentId,
        communityId,
        source: 'update_event_insert_first_service',
      });
    } else {
      const active = isOpenServiceRow(existingService.record.EndDate);
      logger.info(
        {
          eventMessageId: event.EventMessageId,
          eventType: event.EventType,
          residentId,
          communityId,
          source: 'update_event',
          serviceRowId: existingService.id,
          patientNumber: String(residentId),
          cuid: serviceCommunity.cuid,
          currentServiceType: currentServiceType ?? null,
          incomingServiceType,
          hasChanged,
          active,
          currentStartDate: existingService.record.StartDate ?? null,
          currentEndDate: existingService.record.EndDate ?? null,
          boundaryDate,
        },
        'service_transition_evaluated',
      );

      if (active && hasChanged) {
        await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, existingService.id, {
          EndDate: boundaryDate,
        });
        logger.info(
          {
            eventMessageId: event.EventMessageId,
            eventType: event.EventType,
            residentId,
            communityId,
            source: 'update_event_classification_change',
            serviceRowId: existingService.id,
            patientNumber: String(residentId),
            cuid: serviceCommunity.cuid,
            endDate: boundaryDate,
          },
          'service_row_closed',
        );
        await createServiceRow({
          patientNumber: String(residentId),
          cuid: serviceCommunity.cuid,
          communityName: serviceCommunity.communityName,
          serviceType: incomingServiceType,
          startDate: boundaryDate,
          eventMessageId: event.EventMessageId,
          eventType: event.EventType,
          residentId,
          communityId,
          source: 'update_event_classification_change',
        });
      } else if (!active) {
        await createServiceRow({
          patientNumber: String(residentId),
          cuid: serviceCommunity.cuid,
          communityName: serviceCommunity.communityName,
          serviceType: incomingServiceType,
          startDate: boundaryDate,
          eventMessageId: event.EventMessageId,
          eventType: event.EventType,
          residentId,
          communityId,
          source: 'update_event_existing_closed_row',
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

