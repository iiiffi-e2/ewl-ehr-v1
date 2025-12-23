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
  insertRecord,
  updateRecordById,
} from './caspioClient.js';
import type { CaspioRecord } from './caspioMapper.js';
import {
  mapMoveInEventToResidentRecord,
  mapMoveOutEventToVacantRecord,
  mapUpdateEventToResidentPatch,
  redactForLogs,
} from './caspioMapper.js';

/**
 * Extract residentId from event NotificationData
 */
function extractResidentId(event: AlisEvent): number {
  const notificationData = event.NotificationData || {};
  const residentId = notificationData.ResidentId || notificationData.residentId;
  
  if (typeof residentId === 'number' && Number.isFinite(residentId)) {
    return residentId;
  }
  if (typeof residentId === 'string' && residentId.trim().length > 0) {
    const parsed = Number(residentId);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  
  throw new Error('ResidentId is required in NotificationData');
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
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
    return { found: false };
  }

  const result = await findRecordByResidentIdAndCommunityId(
    env.CASPIO_TABLE_NAME,
    residentId,
    communityId,
  );

  return {
    found: result.found,
    id: result.id,
    record: result.record as CaspioRecord | undefined,
  };
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
    const response = await insertRecord(env.CASPIO_TABLE_NAME, record);
    
    // Extract ID from response
    const responseData = response.data as Record<string, unknown>;
    let id: string | undefined;
    if (responseData.PK) {
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
  const response = await insertRecord(env.CASPIO_TABLE_NAME, vacantRecord);

  // Extract ID from response
  const responseData = response.data as Record<string, unknown>;
  let id: string | undefined;
  if (responseData.PK) {
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
    // Extract residentId and communityId
    const residentId = extractResidentId(event);
    const communityId = event.CommunityId;

    if (!communityId) {
      logger.warn(
        { eventMessageId, eventType, residentId },
        'event_missing_community_id_skipping',
      );
      return;
    }

    // Route by event type
    switch (eventType) {
      case 'residents.move_in':
        await handleMoveInEvent(event, companyId, companyKey, residentId, communityId);
        break;

      case 'residents.move_out':
        await handleMoveOutEvent(event, companyId, companyKey, residentId, communityId);
        break;

      default:
        // All other event types (basic_info_updated, created, contact.updated, etc.)
        await handleUpdateEvent(event, companyId, companyKey, residentId, communityId);
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

