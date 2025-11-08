import { Queue } from 'bullmq';

import { logger } from '../config/logger.js';

import { getRedisConnection } from './connection.js';
import type { ProcessAlisEventJobData } from './types.js';

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
