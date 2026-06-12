import { Queue } from 'bullmq';

import { logger } from '../config/logger.js';

import { getRedisConnection } from './connection.js';
import type { ProcessAlisEventJobData, ResidentBackfillJobData, YardiFhirPollJobData } from './types.js';

export const PROCESS_ALIS_EVENT_QUEUE = 'process-alis-event';

export const processAlisEventQueue = new Queue<ProcessAlisEventJobData>(PROCESS_ALIS_EVENT_QUEUE, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnFail: false,
    removeOnComplete: 100,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

processAlisEventQueue.on('error', (error) => {
  logger.error({ message: error.message }, 'queue_error');
});

export const RESIDENT_BACKFILL_QUEUE = 'resident-backfill';

export const residentBackfillQueue = new Queue<ResidentBackfillJobData>(RESIDENT_BACKFILL_QUEUE, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnFail: false,
    removeOnComplete: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

residentBackfillQueue.on('error', (error) => {
  logger.error({ message: error.message }, 'queue_error');
});

export const YARDI_FHIR_POLL_QUEUE = 'yardi-fhir-poll';

export const yardiFhirPollQueue = new Queue<YardiFhirPollJobData>(YARDI_FHIR_POLL_QUEUE, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnFail: false,
    removeOnComplete: 50,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

yardiFhirPollQueue.on('error', (error) => {
  logger.error({ message: error.message }, 'queue_error');
});
