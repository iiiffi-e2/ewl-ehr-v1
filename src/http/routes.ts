import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { openApiDocument } from '../docs/openapi.js';
import { verifyAlisConnectivity } from '../integrations/alisClient.js';
import { prisma } from '../db/prisma.js';
import { getRedisConnection } from '../workers/connection.js';
import { logger } from '../config/logger.js';
import { alisWebhookHandler } from '../webhook/handler.js';

import { authWebhook } from './middleware/authWebhook.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/health/deps', async (_req, res) => {
  const result = await healthCheck();
  const statusCode = result.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(result);
});

router.post('/webhook/alis', authWebhook, async (req, res, next) => {
  try {
    await alisWebhookHandler(req, res);
  } catch (error) {
    next(error);
  }
});

router.get('/docs.json', (_req, res) => {
  res.json(openApiDocument);
});

router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

async function healthCheck(): Promise<{
  status: 'ok' | 'error';
  alis: string;
  database: string;
  redis: string;
}> {
  let alisStatus: string = 'ok';
  let dbStatus: string = 'ok';
  let redisStatus: string = 'ok';

  try {
    await verifyAlisConnectivity();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alisStatus = `error: ${message}`;
    logger.error({ message }, 'healthcheck_alis_failed');
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dbStatus = `error: ${message}`;
    logger.error({ message }, 'healthcheck_database_failed');
  }

  try {
    const redis = getRedisConnection();
    await redis.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    redisStatus = `error: ${message}`;
    logger.error({ message }, 'healthcheck_redis_failed');
  }

  const overallStatus =
    alisStatus === 'ok' && dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'error';

  return {
    status: overallStatus,
    alis: alisStatus,
    database: dbStatus,
    redis: redisStatus,
  };
}
