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
  findByPatientNumber,
  findRecordByFields,
} from '../integrations/caspio/caspioClient.js';
import { getCommunityEnrichment } from '../integrations/caspio/caspioCommunityEnrichment.js';
import { errorToIssueDetails, recordEventIssue } from '../domains/eventIssues.js';
import { markEventFailed, markEventProcessed } from '../domains/events.js';
import { upsertResident } from '../domains/residents.js';
import { requiresLeaveFetch, requiresResidentFetch } from '../webhook/schemas.js';
import type { AlisEvent } from '../webhook/schemas.js';

import { getRedisConnection } from './connection.js';
import { PROCESS_ALIS_EVENT_QUEUE } from './queue.js';
import type { ProcessAlisEventJobData } from './types.js';

export function startProcessAlisEventWorker(): Worker<ProcessAlisEventJobData> {
  logger.info(
    {
      caspioPatientTable: env.CASPIO_TABLE_NAME,
      caspioCommunityTable: env.CASPIO_COMMUNITY_TABLE_NAME,
      caspioServiceTable: env.CASPIO_SERVICE_TABLE_NAME,
    },
    'worker_caspio_table_configuration',
  );
  if (env.CASPIO_TABLE_NAME.toLowerCase().includes('temp')) {
    logger.warn(
      { caspioPatientTable: env.CASPIO_TABLE_NAME },
      'worker_caspio_patient_table_is_temp_verify_schema',
    );
  }

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
      await markEventProcessed({ companyId, eventType, eventMessageId });
      return;
    }

    const residentId = extractNumeric(notificationData, ['ResidentId', 'residentId']);

    if (!residentId) {
      await recordEventIssue({
        companyId,
        eventType,
        eventMessageId,
        communityId,
        stage: 'webhook_payload',
        severity: 'error',
        message: 'ResidentId missing from NotificationData',
        details: { notificationData },
        retryable: false,
      });
      throw new Error('ResidentId missing from NotificationData');
    }

    const isContactEvent =
      eventType === 'resident.contact.created' ||
      eventType === 'resident.contact.updated' ||
      eventType === 'resident.contact.deleted';
    let shouldProcessCaspio = true;

    if (isContactEvent) {
      try {
        let lookup;
        if (communityId) {
          const enrichment = await getCommunityEnrichment(communityId);
          lookup = enrichment.CUID
            ? await findRecordByFields(env.CASPIO_TABLE_NAME, [
                { field: 'PatientNumber', value: String(residentId) },
                { field: 'CUID', value: enrichment.CUID },
              ])
            : await findByPatientNumber(env.CASPIO_TABLE_NAME, residentId);
        } else {
          lookup = await findByPatientNumber(env.CASPIO_TABLE_NAME, residentId);
        }
        if (!lookup.found) {
          await recordEventIssue({
            companyId,
            eventType,
            eventMessageId,
            residentId,
            communityId,
            stage: 'caspio_patient_lookup',
            severity: 'warning',
            message: 'Contact event skipped because resident was not found in Caspio',
            details: {
              reason: 'contact_event_resident_not_found',
            },
            retryable: false,
          });
          logger.info(
            { eventMessageId, residentId, communityId },
            'contact_event_resident_not_found_skipping_caspio',
          );
          shouldProcessCaspio = false;
        }
      } catch (error) {
        await recordEventIssue({
          companyId,
          eventType,
          eventMessageId,
          residentId,
          communityId,
          stage: 'caspio_patient_lookup',
          severity: 'warning',
          message: error instanceof Error ? error.message : String(error),
          details: errorToIssueDetails(error),
          retryable: true,
        });
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

    if (!isContactEvent || shouldProcessCaspio) {
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
        await recordEventIssue({
          companyId,
          eventType,
          eventMessageId,
          residentId,
          communityId,
          stage: 'alis_full_data_fetch',
          severity: 'warning',
          message: error instanceof Error ? error.message : String(error),
          details: errorToIssueDetails(error),
          retryable: true,
        });
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
      try {
        await handleAlisEvent(event, companyId, companyKey);
      } catch (caspioError) {
        await recordEventIssue({
          companyId,
          eventType,
          eventMessageId,
          residentId,
          communityId,
          stage: 'caspio_processing',
          severity: 'error',
          message: caspioError instanceof Error ? caspioError.message : String(caspioError),
          details: errorToIssueDetails(caspioError),
          retryable: true,
        });
        logger.error(
          {
            eventMessageId,
            residentId,
            error: caspioError instanceof Error ? caspioError.message : String(caspioError),
          },
          'caspio_event_processing_failed',
        );
        throw caspioError;
      }
    }

    await markEventProcessed({ companyId, eventType, eventMessageId });

    logger.info({ eventMessageId, eventType, companyKey }, 'event_processed_successfully');
  } catch (error) {
    await recordEventIssue({
      companyId,
      eventType,
      eventMessageId,
      communityId,
      stage: 'event_processing',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      details: errorToIssueDetails(error),
      retryable: true,
    });
    logger.error(
      {
        eventMessageId,
        eventType,
        companyKey,
        error: error instanceof Error ? error.message : String(error),
      },
      'event_processing_failed',
    );
    await markEventFailed({ companyId, eventType, eventMessageId }, error);
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
