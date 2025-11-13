import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { openApiDocument } from '../docs/openapi.js';
import { verifyAlisConnectivity, createAlisClient } from '../integrations/alisClient.js';
import { prisma } from '../db/prisma.js';
import { getRedisConnection } from '../workers/connection.js';
import { logger } from '../config/logger.js';
import { alisWebhookHandler } from '../webhook/handler.js';
import { env } from '../config/env.js';

import { authWebhook } from './middleware/authWebhook.js';
import { authAdmin } from './middleware/authAdmin.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Redirect to webhook monitor
router.get('/monitor', (_req, res) => {
  res.redirect('/public/webhook-monitor.html');
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

// Temporary secure endpoint to test ALIS Communities API
// Protected with BasicAuth but NOT IP allowlist (unlike webhook endpoint)
router.get('/admin/test-communities', authAdmin, async (_req, res) => {
  try {
    logger.info('admin_test_communities_called');

    const credentials = {
      username: env.ALIS_TEST_USERNAME,
      password: env.ALIS_TEST_PASSWORD,
    };

    const client = createAlisClient(credentials);
    const communities = await client.getCommunities();

    logger.info(
      {
        count: communities.length,
        communities: communities.map((c) => ({
          id: c.CommunityId ?? c.communityId,
          name: c.CommunityName ?? c.communityName,
          companyKey: c.CompanyKey ?? c.companyKey,
        })),
      },
      'test_communities_success',
    );

    res.json({
      success: true,
      count: communities.length,
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/communities`,
      communities: communities.map((c) => ({
        id: c.CommunityId ?? c.communityId,
        name: c.CommunityName ?? c.communityName,
        companyKey: c.CompanyKey ?? c.companyKey,
        address: c.Address ?? c.address,
        city: c.City ?? c.city,
        state: c.State ?? c.state,
        zipCode: c.ZipCode ?? c.zipCode,
        phone: c.Phone ?? c.phone,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'test_communities_failed');

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/communities`,
    });
  }
});

// Test endpoint: Get resident details from ALIS
router.get('/admin/test-resident/:residentId', authAdmin, async (req, res) => {
  try {
    const residentId = Number(req.params.residentId);

    if (!residentId || isNaN(residentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid residentId parameter',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info({ residentId }, 'admin_test_resident_called');

    const credentials = {
      username: env.ALIS_TEST_USERNAME,
      password: env.ALIS_TEST_PASSWORD,
    };

    const client = createAlisClient(credentials);
    const [detail, basicInfo] = await Promise.all([
      client.getResident(residentId),
      client.getResidentBasicInfo(residentId),
    ]);

    logger.info({ residentId }, 'test_resident_success');

    res.json({
      success: true,
      residentId,
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/residents/${residentId}`,
      data: {
        detail,
        basicInfo,
      },
    });
  } catch (error) {
    logger.error({ error, residentId: req.params.residentId }, 'test_resident_failed');

    const residentId = req.params.residentId;
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/residents/${residentId}`,
    });
  }
});

// Test endpoint: Get resident leaves from ALIS
router.get('/admin/test-leaves/:residentId', authAdmin, async (req, res) => {
  try {
    const residentId = Number(req.params.residentId);

    if (!residentId || isNaN(residentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid residentId parameter',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info({ residentId }, 'admin_test_leaves_called');

    const credentials = {
      username: env.ALIS_TEST_USERNAME,
      password: env.ALIS_TEST_PASSWORD,
    };

    const client = createAlisClient(credentials);
    const leaves = await client.getResidentLeaves(residentId);

    logger.info({ residentId, count: leaves.length }, 'test_leaves_success');

    res.json({
      success: true,
      residentId,
      count: leaves.length,
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/residents/${residentId}/leaves`,
      leaves,
    });
  } catch (error) {
    logger.error({ error, residentId: req.params.residentId }, 'test_leaves_failed');

    const residentId = req.params.residentId;
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/residents/${residentId}/leaves`,
    });
  }
});

// Test endpoint: List residents from ALIS with pagination
router.get('/admin/list-residents', authAdmin, async (req, res) => {
  try {
    const companyKey = req.query.companyKey as string | undefined;
    const communityId = req.query.communityId
      ? Number(req.query.communityId)
      : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;

    logger.info({ companyKey, communityId, page, pageSize }, 'admin_list_residents_called');

    const credentials = {
      username: env.ALIS_TEST_USERNAME,
      password: env.ALIS_TEST_PASSWORD,
    };

    const client = createAlisClient(credentials);
    const result = await client.listResidents({
      companyKey,
      communityId,
      page,
      pageSize,
    });

    logger.info(
      {
        companyKey,
        communityId,
        page,
        count: result.residents.length,
        hasMore: result.hasMore,
      },
      'list_residents_success',
    );

    res.json({
      success: true,
      count: result.residents.length,
      hasMore: result.hasMore,
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/residents`,
      filters: {
        companyKey,
        communityId,
        page,
        pageSize,
      },
      residents: result.residents.map((r) => ({
        residentId: r.ResidentId ?? r.residentId,
        firstName: r.FirstName ?? r.firstName,
        lastName: r.LastName ?? r.lastName,
        status: r.Status ?? r.status,
        classification: r.Classification ?? r.classification,
        productType: r.ProductType ?? r.productType,
        dateOfBirth: r.DateOfBirth ?? r.dateOfBirth,
        rooms: r.Rooms ?? r.rooms,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'list_residents_failed');

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      apiEndpoint: `${env.ALIS_API_BASE}/v1/integration/residents`,
    });
  }
});

// Webhook Testing Endpoints

// View all received webhook events
router.get('/admin/webhook-events', authAdmin, async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const status = req.query.status as string | undefined;
    const eventType = req.query.eventType as string | undefined;

    logger.info({ limit, status, eventType }, 'admin_webhook_events_called');

    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (eventType) {
      where.eventType = eventType;
    }

    const events = await prisma.eventLog.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      include: {
        company: {
          select: {
            companyKey: true,
          },
        },
      },
    });

    const summary = await prisma.eventLog.groupBy({
      by: ['status'],
      _count: true,
    });

    logger.info(
      {
        count: events.length,
        filters: { status, eventType, limit },
      },
      'webhook_events_retrieved',
    );

    res.json({
      success: true,
      count: events.length,
      timestamp: new Date().toISOString(),
      filters: { status, eventType, limit },
      summary: summary.map((s) => ({
        status: s.status,
        count: s._count,
      })),
      events: events.map((e) => ({
        id: e.id,
        eventMessageId: e.eventMessageId,
        eventType: e.eventType,
        status: e.status,
        companyKey: e.company.companyKey,
        communityId: e.communityId,
        receivedAt: e.receivedAt,
        processedAt: e.processedAt,
        error: e.error,
        payload: e.payload,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'webhook_events_retrieval_failed');

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Simulate a webhook event for testing
router.post('/admin/simulate-webhook', authAdmin, async (req, res) => {
  try {
    const {
      eventType = 'test.event',
      companyKey = 'TEST_COMPANY',
      communityId = null,
      notificationData = {},
    } = req.body;

    const eventMessageId = `TEST_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const eventMessageDate = new Date().toISOString();

    const testPayload = {
      CompanyKey: companyKey,
      CommunityId: communityId,
      EventType: eventType,
      EventMessageId: eventMessageId,
      EventMessageDate: eventMessageDate,
      NotificationData: notificationData,
    };

    logger.info(
      {
        eventMessageId,
        eventType,
        companyKey,
      },
      'admin_simulate_webhook_called',
    );

    // Call the webhook handler directly
    const mockReq = {
      body: testPayload,
    } as any;

    const mockRes = {
      status: (code: number) => ({
        json: (data: any) => {
          logger.info(
            {
              statusCode: code,
              response: data,
            },
            'simulate_webhook_response',
          );
          return { statusCode: code, data };
        },
      }),
    } as any;

    const result = await alisWebhookHandler(mockReq, mockRes);

    res.json({
      success: true,
      message: 'Webhook simulation completed',
      timestamp: new Date().toISOString(),
      testPayload,
      result,
    });
  } catch (error) {
    logger.error({ error }, 'simulate_webhook_failed');

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Get details of a specific webhook event
router.get('/admin/webhook-events/:eventMessageId', authAdmin, async (req, res) => {
  try {
    const { eventMessageId } = req.params;

    logger.info({ eventMessageId }, 'admin_webhook_event_detail_called');

    const event = await prisma.eventLog.findUnique({
      where: { eventMessageId },
      include: {
        company: {
          select: {
            id: true,
            companyKey: true,
            createdAt: true,
          },
        },
      },
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
        eventMessageId,
        timestamp: new Date().toISOString(),
      });
    }

    logger.info({ eventMessageId, status: event.status }, 'webhook_event_detail_retrieved');

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      event: {
        id: event.id,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: event.status,
        company: event.company,
        communityId: event.communityId,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
        error: event.error,
        payload: event.payload,
      },
    });
  } catch (error) {
    logger.error({ error, eventMessageId: req.params.eventMessageId }, 'webhook_event_detail_failed');

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Real-time webhook event stream (Server-Sent Events)
router.get('/admin/webhook-events-stream', authAdmin, async (req, res) => {
  logger.info('admin_webhook_events_stream_connected');

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Webhook event stream connected', timestamp: new Date().toISOString() })}\n\n`);

  // Poll database for new events
  let lastEventId = 0;
  
  const pollInterval = setInterval(async () => {
    try {
      const newEvents = await prisma.eventLog.findMany({
        where: {
          id: {
            gt: lastEventId,
          },
        },
        orderBy: {
          id: 'asc',
        },
        take: 10,
        include: {
          company: {
            select: {
              companyKey: true,
            },
          },
        },
      });

      if (newEvents.length > 0) {
        for (const event of newEvents) {
          const eventData = {
            type: 'event',
            data: {
              id: event.id,
              eventMessageId: event.eventMessageId,
              eventType: event.eventType,
              status: event.status,
              companyKey: event.company.companyKey,
              communityId: event.communityId,
              receivedAt: event.receivedAt,
              processedAt: event.processedAt,
              error: event.error,
              payload: event.payload,
            },
            timestamp: new Date().toISOString(),
          };

          res.write(`data: ${JSON.stringify(eventData)}\n\n`);
          lastEventId = event.id;
        }
      }

      // Send heartbeat every poll to keep connection alive
      res.write(`:heartbeat ${Date.now()}\n\n`);
    } catch (error) {
      logger.error({ error }, 'webhook_stream_poll_error');
    }
  }, 2000); // Poll every 2 seconds

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(pollInterval);
    logger.info({ lastEventId }, 'admin_webhook_events_stream_disconnected');
  });
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
