import { logger } from '../config/logger.js';

import { startProcessAlisEventWorker } from './processAlisEvent.js';
import { startResidentBackfillWorker } from './residentBackfill.js';
import { closeRedisConnection } from './connection.js';

async function bootstrap(): Promise<void> {
  const worker = startProcessAlisEventWorker();
  const backfillWorker = startResidentBackfillWorker();

  logger.info('ALIS event worker started');
  logger.info('Resident backfill worker started');

  const shutdown = async () => {
    logger.info('shutting_down_worker');
    await worker.close();
    await backfillWorker.close();
    await closeRedisConnection();
    logger.info('worker_stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  logger.error({ error }, 'worker_bootstrap_failed');
  process.exit(1);
});
