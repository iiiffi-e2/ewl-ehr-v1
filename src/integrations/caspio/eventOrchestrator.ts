import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  createAlisClient,
  fetchAllResidentData,
  resolveAlisCredentials,
  type AllResidentData,
} from '../alisClient.js';
import type { AlisEvent } from '../../webhook/schemas.js';

import {
  findRecordByResidentIdAndCommunityId,
  findByResidentId,
  insertRecord,
  updateRecordById,
} from './caspioClient.js';
import { getCommunityEnrichment } from './caspioCommunityEnrichment.js';
import type { CaspioRecord } from './caspioMapper.js';
import {
  mapMoveInEventToResidentRecord,
  mapMoveOutEventToVacantRecord,
  mapUpdateEventToResidentPatch,
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
  record: Partial<CaspioRecord>,
): Promise<void> {
  try {
    const enrichment = await getCommunityEnrichment(communityId, roomNumber);
    if (enrichment.CommunityGroup) {
      record.CommunityGroup = enrichment.CommunityGroup;
    }
    if (enrichment.Neighborhood) {
      record.Neighborhood = enrichment.Neighborhood;
    }
    if (enrichment.SerialNumber) {
      record.SerialNumber = enrichment.SerialNumber;
    }
  } catch (error) {
    logger.warn(
      {
        communityId,
        hasRoomNumber: Boolean(roomNumber),
        error: error instanceof Error ? error.message : String(error),
      },
      'caspio_community_enrichment_failed',
    );
  }
}

/**
 * Fetch full resident data if needed
 */
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
 * Check if resident record exists in Caspio
 * Tries composite key lookup first, falls back to Resident_ID only for legacy records
 */
async function ensureResidentExists(
  residentId: number,
  communityId: number,
  required: boolean = false,
): Promise<{ found: boolean; id?: string; record?: CaspioRecord }> {
  if (!communityId) {
    if (required) {
      throw new Error('CommunityId is required for resident lookup');
    }
    // Try Resident_ID only lookup as fallback
    const result = await findByResidentId(env.CASPIO_TABLE_NAME, residentId);
    return {
      found: result.found,
      id: result.id,
      record: result.raw as CaspioRecord | undefined,
    };
  }

  // First try composite key lookup (Resident_ID + Community_ID)
  const result = await findRecordByResidentIdAndCommunityId(
    env.CASPIO_TABLE_NAME,
    residentId,
    communityId,
  );

  if (result.found) {
    return {
      found: true,
      id: result.id,
      record: result.record as CaspioRecord | undefined,
    };
  }

  // Fallback: try Resident_ID only (for legacy records without Community_ID)
  // Only do this for update operations, not for move-in (new records should have Community_ID)
  logger.debug(
    { residentId, communityId },
    'composite_key_not_found_trying_resident_id_only',
  );
  const fallbackResult = await findByResidentId(env.CASPIO_TABLE_NAME, residentId);
  
  if (fallbackResult.found && fallbackResult.raw) {
    const record = fallbackResult.raw as CaspioRecord;
    // Only use fallback if the record doesn't have a Community_ID set (legacy record)
    // or if it matches the requested Community_ID
    const recordCommunityId = record.Community_ID;
    if (!recordCommunityId || recordCommunityId === communityId) {
      logger.info(
        { residentId, communityId, foundCommunityId: recordCommunityId },
        'using_resident_id_only_fallback_for_legacy_record',
      );
      return {
        found: true,
        id: fallbackResult.id,
        record: record,
      };
    }
  }

  return { found: false };
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

  // Check if resident exists
  const existing = await ensureResidentExists(residentId, communityId, false);

  // Fetch full resident data
  const fullResidentData = await fetchFullResidentDataIfNeeded(
    companyId,
    companyKey,
    residentId,
    communityId,
  );

  if (existing.found && existing.id) {
    // Update existing record (idempotency) - but don't overwrite Move_in_Date
    const patch = mapUpdateEventToResidentPatch(
      event,
      fullResidentData,
      existing.record,
    );
    
    // Ensure we don't include Move_in_Date in patch
    const { Move_in_Date, ...patchWithoutMoveIn } = patch;
    
    // Ensure Community_ID is set if it was missing (for legacy records)
    if (!existing.record?.Community_ID && communityId) {
      patchWithoutMoveIn.Community_ID = communityId;
    }

    const roomNumber = patchWithoutMoveIn.Room_number ?? existing.record?.Room_number;
    await applyCommunityEnrichment(communityId, roomNumber, patchWithoutMoveIn);
    
    await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, patchWithoutMoveIn);
    
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        residentId,
        communityId,
        caspioId: existing.id,
      },
      'move_in_event_updated_existing_record',
    );
  } else {
    // Insert new record
    const record = mapMoveInEventToResidentRecord(event, fullResidentData);
    await applyCommunityEnrichment(communityId, record.Room_number, record);
    const response = await insertRecord(env.CASPIO_TABLE_NAME, record);
    
    // Extract ID from response (Caspio uses PK_ID as primary key)
    const responseData = response.data as Record<string, unknown>;
    let id: string | undefined;
    if (responseData.PK_ID) {
      id = String(responseData.PK_ID);
    } else if (responseData.PK) {
      id = String(responseData.PK);
    } else if (responseData._id) {
      id = String(responseData._id);
    } else if (responseData.id) {
      id = String(responseData.id);
    } else if (responseData.Id) {
      id = String(responseData.Id);
    }
    
    logger.info(
      {
        eventMessageId: event.EventMessageId,
        residentId,
        communityId,
        caspioId: id,
      },
      'move_in_event_inserted_new_record',
    );
  }
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

  // Check if resident exists (must exist for move-out)
  const existing = await ensureResidentExists(residentId, communityId, true);

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

  // Update resident row: Set Move_Out_Date and Service_End_Date if empty
  const updateData: Partial<CaspioRecord> = {
    Resident_ID: String(residentId),
    Community_ID: communityId,
  };

  if (!existing.record?.Move_Out_Date) {
    updateData.Move_Out_Date = getTodayDateString();
  }

  if (!existing.record?.Service_End_Date) {
    updateData.Service_End_Date = getTodayDateString();
  }

  const roomNumber = existing.record?.Room_number;
  await applyCommunityEnrichment(communityId, roomNumber, updateData);

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, updateData);

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      caspioId: existing.id,
    },
    'move_out_event_updated_resident_record',
  );

  // Insert vacancy row
  const vacantRecord = mapMoveOutEventToVacantRecord(event);
  await applyCommunityEnrichment(communityId, vacantRecord.Room_number, vacantRecord);
  const response = await insertRecord(env.CASPIO_TABLE_NAME, vacantRecord);

  // Extract ID from response (Caspio uses PK_ID as primary key)
  const responseData = response.data as Record<string, unknown>;
  let id: string | undefined;
  if (responseData.PK_ID) {
    id = String(responseData.PK_ID);
  } else if (responseData.PK) {
    id = String(responseData.PK);
  } else if (responseData._id) {
    id = String(responseData._id);
  } else if (responseData.id) {
    id = String(responseData.id);
  } else if (responseData.Id) {
    id = String(responseData.Id);
  }

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      residentId,
      communityId,
      vacantCaspioId: id,
    },
    'move_out_event_inserted_vacancy_record',
  );
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

  // Check if resident exists - if not, ignore the event
  const existing = await ensureResidentExists(residentId, communityId, false);

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

  // Fetch full resident data
  const fullResidentData = await fetchFullResidentDataIfNeeded(
    companyId,
    companyKey,
    residentId,
    communityId,
  );

  // Create patch (excluding Move_in_Date)
  const patch = mapUpdateEventToResidentPatch(event, fullResidentData, existing.record);

  // Ensure we don't include Move_in_Date in patch
  const { Move_in_Date, ...patchWithoutMoveIn } = patch;

  // Ensure Community_ID is set if it was missing (for legacy records)
  if (!existing.record?.Community_ID && communityId) {
    patchWithoutMoveIn.Community_ID = communityId;
  }

  const roomNumber = patchWithoutMoveIn.Room_number ?? existing.record?.Room_number;
  await applyCommunityEnrichment(communityId, roomNumber, patchWithoutMoveIn);

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

  const existing = await ensureResidentExists(residentId, communityId, false);
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

  const patch: Partial<CaspioRecord> = {
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

  const existing = await ensureResidentExists(residentId, communityId, false);
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

  const patch: Partial<CaspioRecord> = {
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

