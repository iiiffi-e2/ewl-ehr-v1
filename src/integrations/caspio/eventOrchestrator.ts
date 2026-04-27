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
  SERVICE_LINE_UNASSIGNED_CLASSIFICATION,
} from './serviceLineTypes.js';

/** Prefer NotificationData room over stale API data for these event types. */
const ROOM_NOTIFICATION_PRIORITY_EVENT_TYPES = new Set([
  'resident.room_assigned',
  'resident.room_changed',
  'residents.move_in_out_info_updated',
]);

function trimNonEmpty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function normalizeRoomIdentifier(value: string | undefined): string | undefined {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) return undefined;
  const compact = trimmed.replace(/\s+/g, '');
  return compact.length > 0 ? compact : undefined;
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

function parseServiceDate(value: unknown): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const mdYDateTimeMatch = trimmed.match(
    /^(\d{1,2})[/:](\d{1,2})[/:](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/,
  );
  if (!mdYDateTimeMatch) {
    return Number.NEGATIVE_INFINITY;
  }
  const [, month, day, year, hour, minute, second] = mdYDateTimeMatch;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
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
  const normalizedRoom = normalizeRoomIdentifier(roomNumber);
  if (normalizedRoom && ROOM_NOTIFICATION_PRIORITY_EVENT_TYPES.has(event.EventType)) {
    patientRecord.ApartmentNumber = normalizedRoom;
    return;
  }
  if (!patientRecord.ApartmentNumber && normalizedRoom) {
    patientRecord.ApartmentNumber = normalizedRoom;
  }
}

/** New room after a move (ALIS `resident.room_changed`, etc.). */
function extractAssignedRoom(event: AlisEvent): string | undefined {
  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  if (!notificationData) return undefined;
  return extractStringValue(notificationData, ['AssignedRoom', 'assignedRoom']);
}

/** Room the resident is moving out of (ALIS `resident.room_changed`). */
function extractUnassignedRoom(event: AlisEvent): string | undefined {
  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  if (!notificationData) return undefined;
  return extractStringValue(notificationData, ['UnassignedRoom', 'unassignedRoom']);
}

async function resolveCuidForCommunityRoom(
  communityId: number,
  room: string | undefined,
): Promise<string | undefined> {
  const normalized = trimNonEmpty(room);
  if (!normalized) return undefined;
  const match = await findCommunityByIdAndRoomNumber(
    communityId,
    normalizeRoomIdentifier(normalized) ?? normalized,
  );
  if (!match.found || !match.record) return undefined;
  const raw = match.record.CUID;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return undefined;
}

type ServiceCommunityContext = {
  matched: boolean;
  cuid?: string;
  communityName?: string;
  roomNumber?: string;
};

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

  // New room for the resident (e.g. ALIS room change); takes precedence over generic RoomNumber.
  const assigned = extractAssignedRoom(event);
  if (assigned) return assigned;

  const direct = extractStringValue(notificationData, [
    'RoomNumber',
    'roomNumber',
    'Room',
    'room',
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

function hasRoomMovementData(event: AlisEvent): boolean {
  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  if (!notificationData) return false;
  if (extractAssignedRoom(event) || extractUnassignedRoom(event)) {
    return true;
  }
  if (event.EventType === 'resident.room_assigned' || event.EventType === 'resident.room_changed') {
    return Boolean(
      extractStringValue(notificationData, [
        'RoomNumber',
        'roomNumber',
        'Room',
        'room',
        'ApartmentNumber',
        'apartmentNumber',
      ]),
    );
  }
  for (const key of ['RoomsAssigned', 'roomsAssigned', 'RoomsUnassigned', 'roomsUnassigned']) {
    const value = notificationData[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return true;
    }
    if (Array.isArray(value)) {
      const hasRoom = value.some((item) => {
        if (!item || typeof item !== 'object') return false;
        return Boolean(extractStringValue(item as Record<string, unknown>, ['RoomNumber', 'Room', 'roomNumber', 'room']));
      });
      if (hasRoom) {
        return true;
      }
    }
  }
  return false;
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

/** ALIS "ServiceType" (e.g. MC, AL) is a different concept from Caspio service-line classification — do not use it here. */
function getClassification(
  event: AlisEvent,
  residentData?: Record<string, unknown>,
  basicInfoData?: Record<string, unknown>,
): string | undefined {
  const classificationKeys = ['Classification', 'classification'];
  const notificationData = event.NotificationData as Record<string, unknown> | undefined;
  return (
    extractStringValue(notificationData, classificationKeys) ??
    extractNestedStringValue(notificationData, classificationKeys) ??
    (residentData ? extractStringValue(residentData, classificationKeys) : undefined) ??
    (basicInfoData ? extractStringValue(basicInfoData, classificationKeys) : undefined)
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
  fallbackCuid?: string;
  fallbackCommunityName?: string;
}): Promise<ServiceCommunityContext> {
  const fallbackCuid = trimNonEmpty(params.fallbackCuid);
  const fallbackCommunityName = trimNonEmpty(params.fallbackCommunityName);
  const requestedRoomNumber = normalizeRoomIdentifier(
    extractRoomNumber(params.event) ?? params.fallbackRoomNumber,
  );
  const resolveFromFallbackCuid = (reason: string) => {
    if (!fallbackCuid) {
      return undefined;
    }
    logger.info(
      {
        eventMessageId: params.event.EventMessageId,
        eventType: params.event.EventType,
        residentId: params.residentId,
        communityId: params.communityId,
        fallbackCuid,
        fallbackCommunityName: fallbackCommunityName ?? null,
        roomNumber: requestedRoomNumber ?? null,
        reason,
      },
      'service_community_context_resolved_from_fallback_cuid',
    );
    return {
      matched: true,
      cuid: fallbackCuid,
      communityName: fallbackCommunityName,
      roomNumber: requestedRoomNumber,
    };
  };

  const roomNumber = requestedRoomNumber;
  if (!roomNumber) {
    const fallback = resolveFromFallbackCuid('missing_room_number');
    if (fallback) return fallback;
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
    const fallback = resolveFromFallbackCuid('community_room_not_found');
    if (fallback) return fallback;
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
  const matchedRoomNumber =
    normalizeRoomIdentifier(
      extractStringValue(communityMatch.record as Record<string, unknown>, [
        'RoomNumber',
        'roomNumber',
        'Room',
        'room',
        'ApartmentNumber',
        'Apartment',
      ]),
    ) ?? roomNumber;

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
      roomNumber: matchedRoomNumber,
      resolvedCuid: cuid,
      resolvedCommunityName: communityName ?? null,
    },
    'service_community_context_resolved',
  );

  return { matched: true, cuid, communityName, roomNumber: matchedRoomNumber };
}

async function createServiceRow(params: {
  patientNumber?: string;
  cuid: string;
  communityName?: string;
  roomNumber?: string;
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
    roomNumber: params.roomNumber,
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
      roomNumber: params.roomNumber ?? null,
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

/**
 * Service rows are keyed by PatientNumber + CUID. CUID is resolved from the Caspio community
 * table by (CommunityId, room number). Data model: each room has a distinct CUID—two rooms
 * must not share the same CUID—so an in-community room change implies a CUID change whenever
 * enrichment uses room-level rows.
 *
 * For `resident.room_changed`, use NotificationData `UnassignedRoom` / `AssignedRoom` to
 * resolve old vs new CUID from the community table; fall back to the stored patient row when
 * the payload omits a room. Close the open row on the old CUID, insert a room Vacant line on
 * the old CUID (no PatientNumber), then open the resident’s active service line on the new CUID.
 */
async function applyRoomTransferServiceTable(params: {
  event: AlisEvent;
  companyId: number;
  companyKey: string;
  residentId: number;
  communityId: number;
  patientNumber: string;
  previousCuid: string;
  nextCuid: string;
  previousRoom?: string;
  nextCommunityName?: string;
  incomingServiceType: string | undefined;
}): Promise<void> {
  const boundaryDate = normalizeScenarioDateTime(params.event.EventMessageDate);

  let incomingServiceType = params.incomingServiceType;
  if (!incomingServiceType) {
    const fullResidentData = await fetchFullResidentDataIfNeeded(
      params.companyId,
      params.companyKey,
      params.residentId,
      params.communityId,
    );
    const resident = fullResidentData.resident as Record<string, unknown>;
    const basicInfo = fullResidentData.basicInfo as Record<string, unknown>;
    incomingServiceType = getClassification(params.event, resident, basicInfo);
  }

  const resolvedServiceType =
    incomingServiceType ?? SERVICE_LINE_UNASSIGNED_CLASSIFICATION;

  const previousRoomTrimmed = normalizeRoomIdentifier(params.previousRoom);
  const oldRoomEnrichment = previousRoomTrimmed
    ? await getCommunityEnrichment(params.communityId, previousRoomTrimmed)
    : undefined;

  await closeLatestServiceRow({
    patientNumber: params.patientNumber,
    cuid: params.previousCuid,
    endDate: boundaryDate,
    eventMessageId: params.event.EventMessageId,
    eventType: params.event.EventType,
    residentId: params.residentId,
    communityId: params.communityId,
    source: 'room_transfer_close_old',
  });

  if (previousRoomTrimmed) {
    await createServiceRow({
      cuid: params.previousCuid,
      communityName: oldRoomEnrichment?.CommunityName ?? undefined,
      roomNumber: previousRoomTrimmed,
      serviceType: ROOM_VACANCY_SERVICE_TYPE,
      startDate: boundaryDate,
      eventMessageId: params.event.EventMessageId,
      eventType: params.event.EventType,
      residentId: params.residentId,
      communityId: params.communityId,
      source: 'room_transfer_old_room_vacant',
    });
  } else {
    logger.warn(
      {
        eventMessageId: params.event.EventMessageId,
        eventType: params.event.EventType,
        residentId: params.residentId,
        communityId: params.communityId,
        previousCuid: params.previousCuid,
      },
      'room_transfer_old_room_vacant_skipped_missing_previous_room',
    );
  }

  await createServiceRow({
    patientNumber: params.patientNumber,
    cuid: params.nextCuid,
    communityName: params.nextCommunityName,
    roomNumber: normalizeRoomIdentifier(extractAssignedRoom(params.event) ?? extractRoomNumber(params.event)),
    serviceType: resolvedServiceType,
    startDate: boundaryDate,
    eventMessageId: params.event.EventMessageId,
    eventType: params.event.EventType,
    residentId: params.residentId,
    communityId: params.communityId,
    source: 'room_transfer_new_room',
  });

  logger.info(
    {
      eventMessageId: params.event.EventMessageId,
      eventType: params.event.EventType,
      residentId: params.residentId,
      communityId: params.communityId,
      patientNumber: params.patientNumber,
      previousCuid: params.previousCuid,
      nextCuid: params.nextCuid,
      previousRoom: previousRoomTrimmed ?? null,
      serviceType: resolvedServiceType,
    },
    'room_transfer_service_completed',
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
  const roomNumber = normalizeRoomIdentifier(extractRoomNumber(event));
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
  const serviceType =
    getClassification(event, resident, basicInfo) ?? SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
  const serviceCommunity = await resolveServiceCommunityContext({
    event,
    residentId,
    communityId,
    fallbackRoomNumber: normalizeRoomIdentifier(patientRecord.ApartmentNumber),
  });
  if (serviceCommunity.matched && serviceCommunity.cuid) {
    await createServiceRow({
      patientNumber: String(residentId),
      cuid: serviceCommunity.cuid,
      communityName: serviceCommunity.communityName,
      roomNumber: serviceCommunity.roomNumber,
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

  const roomNumber = normalizeRoomIdentifier(extractRoomNumber(event));
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
    fallbackRoomNumber: normalizeRoomIdentifier(existing.record?.ApartmentNumber),
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
      roomNumber: serviceCommunity.roomNumber,
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
      roomNumber: serviceCommunity.roomNumber,
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

  const roomNumber = normalizeRoomIdentifier(extractRoomNumber(event));
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
  const normalizedApartmentNumber = normalizeRoomIdentifier(patientRecord.ApartmentNumber);
  if (normalizedApartmentNumber) {
    patientRecord.ApartmentNumber = normalizedApartmentNumber;
  }
  const effectiveRoom = normalizedApartmentNumber ?? roomNumber;
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

  const unassignedRoomStr = extractUnassignedRoom(event);
  const previousCuidFromUnassignedRoom = await resolveCuidForCommunityRoom(
    communityId,
    unassignedRoomStr,
  );
  const previousCuid =
    previousCuidFromUnassignedRoom ?? trimNonEmpty(existing.record?.CUID);
  const previousRoom =
    normalizeRoomIdentifier(unassignedRoomStr) ?? normalizeRoomIdentifier(existing.record?.ApartmentNumber);
  const nextCuid = trimNonEmpty(patientRecord.CUID);
  const isCuidRoomTransfer = Boolean(
    previousCuid && nextCuid && previousCuid !== nextCuid,
  );

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, patchWithoutMoveIn);

  const resident = fullResidentData.resident as Record<string, unknown>;
  const basicInfo = fullResidentData.basicInfo as Record<string, unknown>;
  let classificationForService = getClassification(event, resident, basicInfo);
  const caspioRowLooksMovedOut = isPatientRecordMovedOut(existing.record);
  const roomEventAllowsServiceDespiteMoveOutFields =
    caspioRowLooksMovedOut &&
    ROOM_NOTIFICATION_PRIORITY_EVENT_TYPES.has(event.EventType) &&
    hasRoomMovementData(event);
  const skipServiceTransitions = caspioRowLooksMovedOut && !roomEventAllowsServiceDespiteMoveOutFields;
  if (roomEventAllowsServiceDespiteMoveOutFields) {
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        eventType: event.EventType,
        residentId,
        communityId,
      },
      'update_event_service_room_event_proceeds_despite_move_out_fields_on_row',
    );
  }
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
  } else if (isCuidRoomTransfer && previousCuid && nextCuid) {
    await applyRoomTransferServiceTable({
      event,
      companyId,
      companyKey,
      residentId,
      communityId,
      patientNumber: String(residentId),
      previousCuid: previousCuid,
      nextCuid: nextCuid,
      previousRoom,
      nextCommunityName: patientRecord.CommunityName ?? communityContext.CommunityName,
      incomingServiceType: classificationForService,
    });
  } else {
    const serviceRoomFallback =
      normalizeRoomIdentifier(patientRecord.ApartmentNumber) ??
      normalizeRoomIdentifier(existing.record?.ApartmentNumber);
    const serviceCommunity = await resolveServiceCommunityContext({
      event,
      residentId,
      communityId,
      fallbackRoomNumber: serviceRoomFallback,
      fallbackCuid: trimNonEmpty(patientRecord.CUID) ?? trimNonEmpty(existing.record?.CUID),
      fallbackCommunityName:
        trimNonEmpty(patientRecord.CommunityName) ?? trimNonEmpty(existing.record?.CommunityName),
    });
    if (serviceCommunity.matched && serviceCommunity.cuid) {
      const boundaryDate = normalizeScenarioDateTime(event.EventMessageDate);
      const existingService = await findActiveOrLatestServiceRow({
        patientNumber: String(residentId),
        cuid: serviceCommunity.cuid,
      });

      const currentServiceType =
        existingService.found && existingService.record && typeof existingService.record.ServiceType === 'string'
          ? existingService.record.ServiceType
          : undefined;

      const preliminaryIncoming =
        classificationForService ?? SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
      const preliminaryHasChanged =
        !currentServiceType ||
        normalizeServiceType(currentServiceType) !== normalizeServiceType(preliminaryIncoming);

      if (
        event.EventType === 'residents.basic_info_updated' &&
        (!classificationForService || !preliminaryHasChanged)
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
          classificationForService = refreshedServiceType;
        }
      }

      const incomingServiceType =
        classificationForService ?? SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
      const isFallbackUnassigned = classificationForService === undefined;

      const hasChanged =
        !currentServiceType ||
        normalizeServiceType(currentServiceType) !== normalizeServiceType(incomingServiceType);

      if (!existingService.found || !existingService.id || !existingService.record) {
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
          roomNumber: serviceCommunity.roomNumber,
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

        const currentStartDateMs = parseServiceDate(existingService.record.StartDate);
        const boundaryDateMs = parseServiceDate(boundaryDate);
        const staleFallbackUnassignedAfterVacant =
          active &&
          hasChanged &&
          isFallbackUnassigned &&
          normalizeServiceType(currentServiceType) === normalizeServiceType(ROOM_VACANCY_SERVICE_TYPE) &&
          normalizeServiceType(incomingServiceType) ===
            normalizeServiceType(SERVICE_LINE_UNASSIGNED_CLASSIFICATION) &&
          currentStartDateMs !== Number.NEGATIVE_INFINITY &&
          boundaryDateMs !== Number.NEGATIVE_INFINITY &&
          boundaryDateMs <= currentStartDateMs;

        if (staleFallbackUnassignedAfterVacant) {
          logger.info(
            {
              eventMessageId: event.EventMessageId,
              eventType: event.EventType,
              residentId,
              communityId,
              source: 'update_event_stale_unassigned_after_vacant',
              serviceRowId: existingService.id,
              patientNumber: String(residentId),
              cuid: serviceCommunity.cuid,
              currentServiceType: currentServiceType ?? null,
              incomingServiceType,
              currentStartDate: existingService.record.StartDate ?? null,
              boundaryDate,
            },
            'service_transition_skipped_stale_unassigned_after_vacant',
          );
          return;
        }

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
            roomNumber: serviceCommunity.roomNumber,
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
            roomNumber: serviceCommunity.roomNumber,
            serviceType: incomingServiceType,
            startDate: boundaryDate,
            eventMessageId: event.EventMessageId,
            eventType: event.EventType,
            residentId,
            communityId,
            source: 'update_event_existing_closed_row',
          });
        } else if (!hasChanged) {
          logger.info(
            {
              eventMessageId: event.EventMessageId,
              eventType: event.EventType,
              residentId,
              communityId,
              patientNumber: String(residentId),
              cuid: serviceCommunity.cuid,
              currentServiceType: currentServiceType ?? null,
              incomingServiceType,
              active,
            },
            'service_row_unchanged_no_write',
          );
        }
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

