import type { OpenAPIV3 } from 'openapi-types';

import { env } from '../config/env.js';

const webhookSchema: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['CompanyKey', 'EventType', 'EventMessageId', 'EventMessageDate'],
  properties: {
    CompanyKey: { type: 'string', example: 'appstoresandbox' },
    CommunityId: { type: 'integer', nullable: true, example: 123 },
    EventType: {
      type: 'string',
      example: 'residents.move_in',
      enum: [
        'residents.move_in',
        'residents.move_out',
        'residents.leave_start',
        'residents.leave_end',
        'residents.leave_cancelled',
        'residents.basic_info_updated',
        'test.event',
      ],
    },
    EventMessageId: { type: 'string', example: 'evt_123' },
    EventMessageDate: { type: 'string', format: 'date-time' },
    NotificationData: {
      type: 'object',
      additionalProperties: true,
      example: { ResidentId: 456, LeaveId: 789 },
    },
  },
};

export const openApiDocument: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'ALIS → EyeWatch LIVE Integration API',
    version: '0.1.0',
    description:
      'Webhook surface and operational endpoints for processing ALIS resident events and forwarding to Caspio.',
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns service health status.',
        responses: {
          '200': {
            description: 'Service is healthy.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health/deps': {
      get: {
        summary: 'Dependency health',
        description: 'Checks downstream dependencies (ALIS API, database, Redis).',
        responses: {
          '200': {
            description: 'Dependencies reachable.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    alis: { type: 'string', example: 'ok' },
                    database: { type: 'string', example: 'ok' },
                    redis: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
          '503': {
            description: 'One or more dependencies unavailable.',
          },
        },
      },
    },
    '/webhook/alis': {
      post: {
        summary: 'ALIS webhook endpoint',
        description:
          'Receives ALIS events, enqueues processing jobs, and ensures idempotent handling by EventMessageId.',
        security: [{ basicAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: webhookSchema,
            },
          },
        },
        responses: {
          '202': {
            description: 'Event accepted and queued for processing.',
          },
          '200': {
            description: 'Duplicate event received and acknowledged.',
          },
          '401': { description: 'Basic authentication failed.' },
          '403': { description: 'Request IP is not in allowlist.' },
          '400': { description: 'Validation error.' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      basicAuth: {
        type: 'http',
        scheme: 'basic',
      },
    },
  },
};
