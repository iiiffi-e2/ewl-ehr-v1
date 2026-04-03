import { Job, Worker } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { resolveEhrAdapter } from '../integrations/ehr/registry.js';
import { handleEhrEvent } from '../integrations/ehr/orchestrator.js';
import type { CanonicalInboundEvent } from '../integrations/ehr/types.js';
import {
  findByPatientNumber,
  findRecordByFields,
} from '../integrations/caspio/caspioClient.js';
import { getCommunityEnrichment } from '../integrations/caspio/caspioCommunityEnrichment.js';
import { markEventFailed, markEventProcessed } from '../domains/events.js';
import { upsertResident } from '../domains/residents.js';

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
    source,
    eventMessageId,
    eventType,
    companyKey,
    companyId,
    communityId,
    notificationData,
    eventMessageDate,
  } = job.data;

  logger.info({ source, eventMessageId, eventType, companyKey }, 'worker_processing_event');

  try {
    if (!env.EHR_ADAPTER_ENABLED && source !== 'alis') {
      logger.info({ source, eventMessageId, eventType }, 'ehr_adapter_disabled_skipping_event');
      await markEventProcessed({ companyId, eventType, eventMessageId, source });
      return;
    }
    if (
      source !== 'alis' &&
      env.ehrEnabledCommunityIds.length > 0 &&
      (communityId === null || !env.ehrEnabledCommunityIds.includes(communityId))
    ) {
      logger.info(
        { source, eventMessageId, eventType, communityId },
        'ehr_source_not_enabled_for_community_skipping_event',
      );
      await markEventProcessed({ companyId, eventType, eventMessageId, source });
      return;
    }

    const adapter = resolveEhrAdapter(source);
    if (!adapter.requiresResidentFetch(eventType)) {
      logger.info({ eventMessageId, eventType }, 'event_does_not_require_processing');
      await markEventProcessed({ companyId, eventType, eventMessageId, source });
      return;
    }

    const canonicalEvent: CanonicalInboundEvent = {
      source,
      companyKey,
      communityId: communityId ?? null,
      eventType,
      eventMessageId,
      eventMessageDate,
      lifecycleKind: 'unknown',
      notificationData: notificationData ?? {},
      raw: notificationData ?? {},
    };
    const residentId = adapter.resolveResidentId({ event: canonicalEvent });

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

    const residentBundle = await adapter.fetchResidentBundle({
      companyId,
      companyKey,
      residentId,
      event: canonicalEvent,
    });

    if (!isContactEvent || shouldProcessCaspio) {
      const maybeFullData = (residentBundle.vendorPayload as { fullResidentData?: any } | undefined)
        ?.fullResidentData;
      if (maybeFullData) {
        logger.info(
          {
            eventMessageId,
            residentId,
            communityId,
            insuranceCount: maybeFullData.insurance?.length ?? 0,
            roomAssignmentsCount: maybeFullData.roomAssignments?.length ?? 0,
            diagnosesAndAllergiesCount: maybeFullData.diagnosesAndAllergies?.length ?? 0,
            contactsCount: maybeFullData.contacts?.length ?? 0,
            hasCommunity: !!maybeFullData.community,
            errors: maybeFullData.errors,
          },
          'resident_data_fetched_for_caspio',
        );
      }
    }

    const normalized = residentBundle.demographics;
    await upsertResident(companyId, {
      source,
      externalResidentId: normalized.externalResidentId,
      alisResidentId: residentId,
      status: normalized.status ?? 'unknown',
      productType: normalized.productType ?? null,
      classification: normalized.classification ?? null,
      firstName: normalized.firstName ?? null,
      lastName: normalized.lastName ?? null,
      dateOfBirth: normalized.dateOfBirth ? new Date(normalized.dateOfBirth) : null,
      roomNumber: normalized.roomNumber ?? null,
      bed: normalized.bed ?? null,
      room: normalized.room ?? null,
      updatedAtUtc: normalized.updatedAtUtc ? new Date(normalized.updatedAtUtc) : null,
      onPrem: normalized.onPrem ?? null,
      onPremDate: normalized.onPremDate ? new Date(normalized.onPremDate) : null,
      offPrem: normalized.offPrem ?? null,
      offPremDate: normalized.offPremDate ? new Date(normalized.offPremDate) : null,
    });

    const shouldShadowOnly = env.EHR_SHADOW_MODE && source !== 'alis';

    if (shouldProcessCaspio && !shouldShadowOnly) {
      try {
        await handleEhrEvent({
          source,
          companyId,
          companyKey,
          event: residentBundle.event,
        });
      } catch (caspioError) {
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
    } else if (shouldProcessCaspio && shouldShadowOnly) {
      logger.info(
        {
          source,
          eventMessageId,
          eventType,
          residentId,
        },
        'ehr_shadow_mode_enabled_caspio_write_skipped',
      );
    }

    await markEventProcessed({ companyId, eventType, eventMessageId, source });

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
    await markEventFailed({ companyId, eventType, eventMessageId, source }, error);
    throw error;
  }
}
