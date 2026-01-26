import { Job, Worker } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  createAlisClient,
  fetchAllResidentData,
  resolveAlisCredentials,
} from '../integrations/alisClient.js';
import { normalizeResident } from '../integrations/mappers.js';
import { handleAlisEvent } from '../integrations/caspio/eventOrchestrator.js';
import {
  findByResidentId,
  findRecordByResidentIdAndCommunityId,
} from '../integrations/caspio/caspioClient.js';
import { markEventFailed, markEventProcessed } from '../domains/events.js';
import { upsertResident } from '../domains/residents.js';
import { requiresLeaveFetch, requiresResidentFetch } from '../webhook/schemas.js';
import type { AlisEvent } from '../webhook/schemas.js';

import { getRedisConnection } from './connection.js';
import { PROCESS_ALIS_EVENT_QUEUE } from './queue.js';
import type { ProcessAlisEventJobData } from './types.js';

export function startProcessAlisEventWorker(): Worker<ProcessAlisEventJobData> {
  const worker = new Worker<ProcessAlisEventJobData>(
    PROCESS_ALIS_EVENT_QUEUE,
    async (job) => processJob(job),
    {
      connection: getRedisConnection(),
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    logger.error(
      {
        jobId: job.id,
        eventMessageId: job.data.eventMessageId,
        error: error?.message,
      },
      'worker_job_failed',
    );
  });

  worker.on('completed', (job) => {
    logger.info(
      {
        jobId: job.id,
        eventMessageId: job.data.eventMessageId,
      },
      'worker_job_completed',
    );
  });

  return worker;
}

async function processJob(job: Job<ProcessAlisEventJobData>): Promise<void> {
  const {
    eventMessageId,
    eventType,
    companyKey,
    companyId,
    communityId,
    notificationData,
    eventMessageDate,
  } = job.data;

  logger.info({ eventMessageId, eventType, companyKey }, 'worker_processing_event');

  try {
    if (!requiresResidentFetch(eventType)) {
      logger.info({ eventMessageId, eventType }, 'event_does_not_require_processing');
      await markEventProcessed(eventMessageId);
      return;
    }

    const residentId = extractNumeric(notificationData, ['ResidentId', 'residentId']);

    if (!residentId) {
      throw new Error('ResidentId missing from NotificationData');
    }

    const isContactEvent =
      eventType === 'resident.contact.created' ||
      eventType === 'resident.contact.updated' ||
      eventType === 'resident.contact.deleted';
    const shouldRefreshContacts = eventType === 'resident.contact.deleted';
    let shouldProcessCaspio = true;

    if (isContactEvent) {
      try {
        const lookup = communityId
          ? await findRecordByResidentIdAndCommunityId(
              env.CASPIO_TABLE_NAME,
              residentId,
              communityId,
            )
          : await findByResidentId(env.CASPIO_TABLE_NAME, residentId);
        if (!lookup.found) {
          logger.info(
            { eventMessageId, residentId, communityId },
            'contact_event_resident_not_found_skipping_caspio',
          );
          shouldProcessCaspio = false;
        }
      } catch (error) {
        logger.warn(
          {
            eventMessageId,
            residentId,
            communityId,
            error: error instanceof Error ? error.message : String(error),
          },
          'contact_event_caspio_lookup_failed_continuing',
        );
      }
    }

    const credentials = await resolveAlisCredentials(companyId, companyKey);
    const alisClient = createAlisClient(credentials);

    const [residentDetail, residentBasicInfo] = await Promise.all([
      alisClient.getResident(residentId),
      alisClient.getResidentBasicInfo(residentId),
    ]);

    let leaveData = null;
    if (requiresLeaveFetch(eventType)) {
      const leaveId = extractNumeric(notificationData, ['LeaveId', 'leaveId']);
      if (leaveId) {
        leaveData = await alisClient.getLeave(leaveId);
      } else {
        const leaves = await alisClient.getResidentLeaves(residentId);
        leaveData = leaves.find((leave) => {
          const id = extractNumeric(leave, ['LeaveId', 'leaveId']);
          return Boolean(id);
        }) ?? null;
      }
    }

    if (!isContactEvent || shouldRefreshContacts) {
      // Fetch all resident data for Caspio push
      try {
        const allResidentData = await fetchAllResidentData(
          credentials,
          residentId,
          communityId ?? null,
        );
        logger.info(
          {
            eventMessageId,
            residentId,
            communityId,
            insuranceCount: allResidentData.insurance.length,
            roomAssignmentsCount: allResidentData.roomAssignments.length,
            diagnosesAndAllergiesCount: allResidentData.diagnosesAndAllergies.length,
            contactsCount: allResidentData.contacts.length,
            hasCommunity: !!allResidentData.community,
            errors: allResidentData.errors,
          },
          'resident_data_fetched_for_caspio',
        );
      } catch (error) {
        logger.error(
          {
            eventMessageId,
            residentId,
            error: error instanceof Error ? error.message : String(error),
          },
          'failed_to_fetch_all_resident_data_for_caspio',
        );
      }
    }

    const normalized = normalizeResident({
      detail: residentDetail,
      basicInfo: residentBasicInfo,
    });

    await upsertResident(companyId, normalized);

    // Construct AlisEvent for Caspio event orchestrator
    const event: AlisEvent = {
      EventType: eventType,
      CompanyKey: companyKey,
      CommunityId: communityId ?? null,
      EventMessageId: eventMessageId,
      EventMessageDate: eventMessageDate,
      NotificationData: notificationData,
    };

    if (shouldProcessCaspio) {
      // Handle event via orchestrator (handle errors gracefully - log but don't fail job)
      try {
        await handleAlisEvent(event, companyId, companyKey);
      } catch (caspioError) {
        logger.error(
          {
            eventMessageId,
            residentId,
            error: caspioError instanceof Error ? caspioError.message : String(caspioError),
          },
          'caspio_event_processing_failed_continuing',
        );
        // Don't throw - allow job to complete even if Caspio processing fails
      }
    }

    await markEventProcessed(eventMessageId);

    logger.info({ eventMessageId, eventType, companyKey }, 'event_processed_successfully');
  } catch (error) {
    logger.error(
      {
        eventMessageId,
        eventType,
        companyKey,
        error: error instanceof Error ? error.message : String(error),
      },
      'event_processing_failed',
    );
    await markEventFailed(eventMessageId, error);
    throw error;
  }
}

function extractNumeric(
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
