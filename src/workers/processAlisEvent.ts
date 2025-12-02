import { Job, Worker } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  createAlisClient,
  fetchAllResidentData,
  resolveAlisCredentials,
} from '../integrations/alisClient.js';
import { buildCaspioPayload, normalizeResident } from '../integrations/mappers.js';
import { sendResidentToCaspio } from '../integrations/caspioClient.js';
import { markEventFailed, markEventProcessed } from '../domains/events.js';
import { upsertResident } from '../domains/residents.js';
import { requiresLeaveFetch, requiresResidentFetch } from '../webhook/schemas.js';

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

    // Fetch additional resident data for move_in events
    if (eventType === 'residents.move_in') {
      try {
        const allResidentData = await fetchAllResidentData(credentials, residentId);
        logger.info(
          {
            eventMessageId,
            residentId,
            insuranceCount: allResidentData.insurance.length,
            roomAssignmentsCount: allResidentData.roomAssignments.length,
            diagnosesAndAllergiesCount: allResidentData.diagnosesAndAllergies.length,
            contactsCount: allResidentData.contacts.length,
            errors: allResidentData.errors,
          },
          'move_in_additional_data_fetched',
        );

        // Log detailed data for inspection
        logger.info(
          {
            eventMessageId,
            residentId,
            data: {
              insurance: allResidentData.insurance,
              roomAssignments: allResidentData.roomAssignments,
              diagnosesAndAllergies: allResidentData.diagnosesAndAllergies,
              contacts: allResidentData.contacts,
            },
          },
          'move_in_additional_data_details',
        );
      } catch (error) {
        // Log error but don't fail the entire job
        logger.error(
          {
            eventMessageId,
            residentId,
            error: error instanceof Error ? error.message : String(error),
          },
          'failed_to_fetch_additional_resident_data',
        );
      }
    }

    const normalized = normalizeResident({
      detail: residentDetail,
      basicInfo: residentBasicInfo,
    });

    await upsertResident(companyId, normalized);

    const caspioPayload = buildCaspioPayload({
      resident: normalized,
      companyKey,
      communityId,
      eventType,
      eventMessageId,
      eventTimestamp: eventMessageDate,
      leave: leaveData,
    });

    await sendResidentToCaspio(caspioPayload);

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
