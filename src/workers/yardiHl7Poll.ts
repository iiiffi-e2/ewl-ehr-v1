import { Job, Worker } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { YardiHl7BrokerClient } from '../integrations/yardi/yardiHl7BrokerClient.js';
import { drainYardiHl7Mailbox } from '../integrations/yardi/yardiHl7PollCapture.js';

import { getRedisConnection } from './connection.js';
import { YARDI_HL7_POLL_QUEUE, yardiHl7PollQueue } from './queue.js';
import type { YardiHl7PollJobData } from './types.js';

export function startYardiHl7PollWorker(): Worker<YardiHl7PollJobData> {
  const worker = new Worker<YardiHl7PollJobData>(
    YARDI_HL7_POLL_QUEUE,
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
      'yardi_hl7_poll_job_failed',
    );
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'yardi_hl7_poll_job_completed');
  });

  return worker;
}

export async function registerYardiHl7PollSchedule(): Promise<void> {
  if (!env.YARDI_HL7_POLL_ENABLED) {
    logger.info('yardi_hl7_poll_schedule_disabled');
    return;
  }

  if (!env.YARDI_HL7_MAILBOX_PASSWORD) {
    logger.warn('yardi_hl7_poll_enabled_without_mailbox_password');
    return;
  }

  await yardiHl7PollQueue.add(
    'yardi-hl7-poll-scheduled',
    {},
    {
      jobId: 'yardi-hl7-poll-repeat',
      repeat: {
        every: env.YARDI_HL7_POLL_INTERVAL_MS,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  logger.info(
    {
      intervalMs: env.YARDI_HL7_POLL_INTERVAL_MS,
      maxMessages: env.YARDI_HL7_POLL_MAX_MESSAGES,
    },
    'yardi_hl7_poll_schedule_registered',
  );
}

async function processJob(job: Job<YardiHl7PollJobData>): Promise<void> {
  logger.info({ jobId: job.id }, 'yardi_hl7_poll_job_started');

  const summary = await drainYardiHl7Mailbox({
    client: YardiHl7BrokerClient.fromEnv(),
    maxMessages: env.YARDI_HL7_POLL_MAX_MESSAGES,
  });

  logger.info(
    {
      jobId: job.id,
      captured: summary.captured,
      duplicates: summary.duplicates,
      empty: summary.empty,
    },
    'yardi_hl7_poll_job_finished',
  );
}
