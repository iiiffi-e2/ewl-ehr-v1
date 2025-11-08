import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAlisConnectivity } from '../integrations/alisClient.js';

import { createApp } from './app.js';

async function bootstrap(): Promise<void> {
  const app = createApp();

  try {
    await verifyAlisConnectivity();
    logger.info('ALIS connectivity verified');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'alis_connectivity_check_failed',
    );
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'http_server_started');
  });

  const shutdown = () => {
    logger.info('shutting_down_http_server');
    server.close(() => {
      logger.info('http_server_stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  logger.error({ error }, 'server_bootstrap_failed');
  process.exit(1);
});
