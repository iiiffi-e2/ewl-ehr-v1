import { logger } from '../config/logger.js';

import { startProcessAlisEventWorker } from './processAlisEvent.js';
import { startResidentBackfillWorker } from './residentBackfill.js';
import { closeRedisConnection } from './connection.js';
import { registerYardiFhirPollSchedule, startYardiFhirPollWorker } from './yardiFhirPoll.js';
import { registerYardiHl7PollSchedule, startYardiHl7PollWorker } from './yardiHl7Poll.js';

async function bootstrap(): Promise<void> {
  const worker = startProcessAlisEventWorker();
  const backfillWorker = startResidentBackfillWorker();
  const yardiPollWorker = startYardiFhirPollWorker();
  const yardiHl7PollWorker = startYardiHl7PollWorker();

  logger.info('ALIS event worker started');
  logger.info('Resident backfill worker started');
  logger.info('Yardi FHIR poll worker started');
  logger.info('Yardi HL7 poll worker started');

  await registerYardiFhirPollSchedule();
  await registerYardiHl7PollSchedule();

  const shutdown = async () => {
    logger.info('shutting_down_worker');
    await worker.close();
    await backfillWorker.close();
    await yardiPollWorker.close();
    await yardiHl7PollWorker.close();
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
