import { Job, Worker } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  getConfiguredYardiFhirPollTargets,
  parseYardiFhirPollTargets,
} from '../integrations/yardi/yardiFhirPollConfig.js';
import { createRedisSyncCursorStore } from '../integrations/yardi/yardiFhirPollCursor.js';
import { runYardiFhirSyncForTarget } from '../integrations/yardi/yardiFhirSync.js';
import type { YardiFhirPollTarget } from '../integrations/yardi/yardiFhirTypes.js';

import { getRedisConnection } from './connection.js';
import { YARDI_FHIR_POLL_QUEUE, yardiFhirPollQueue } from './queue.js';
import type { YardiFhirPollJobData } from './types.js';

export function startYardiFhirPollWorker(): Worker<YardiFhirPollJobData> {
  const worker = new Worker<YardiFhirPollJobData>(
    YARDI_FHIR_POLL_QUEUE,
    async (job) => processJob(job),
    {
      connection: getRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    logger.error(
      {
        jobId: job.id,
        error: error?.message,
      },
      'yardi_fhir_poll_job_failed',
    );
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'yardi_fhir_poll_job_completed');
  });

  return worker;
}

export async function registerYardiFhirPollSchedule(): Promise<void> {
  if (!env.YARDI_FHIR_POLL_ENABLED) {
    logger.info('yardi_fhir_poll_schedule_disabled');
    return;
  }

  const targets = getConfiguredYardiFhirPollTargets();
  if (targets.length === 0) {
    logger.warn('yardi_fhir_poll_enabled_without_targets');
    return;
  }

  await yardiFhirPollQueue.add(
    'yardi-fhir-poll-scheduled',
    {},
    {
      jobId: 'yardi-fhir-poll-repeat',
      repeat: {
        every: env.YARDI_FHIR_POLL_INTERVAL_MS,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  logger.info(
    {
      intervalMs: env.YARDI_FHIR_POLL_INTERVAL_MS,
      targetCount: targets.length,
    },
    'yardi_fhir_poll_schedule_registered',
  );
}

async function processJob(job: Job<YardiFhirPollJobData>): Promise<void> {
  const cursorStore = createRedisSyncCursorStore();
  const targets = resolveTargets(job.data);

  logger.info(
    {
      jobId: job.id,
      targetCount: targets.length,
      skipCaspio: job.data.skipCaspio ?? false,
    },
    'yardi_fhir_poll_job_started',
  );

  for (const target of targets) {
    await runYardiFhirSyncForTarget(target, {
      cursorStore,
      skipCaspio: job.data.skipCaspio,
    });
  }
}

function resolveTargets(data: YardiFhirPollJobData): YardiFhirPollTarget[] {
  if (data.companyKey && data.communityId && data.organizationId) {
    return [
      {
        companyKey: data.companyKey,
        communityId: data.communityId,
        organizationId: data.organizationId,
      },
    ];
  }

  return getConfiguredYardiFhirPollTargets();
}

export { parseYardiFhirPollTargets };
