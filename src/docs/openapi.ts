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
      url: env.PUBLIC_URL || `http://localhost:${env.PORT}`,
      description: env.PUBLIC_URL ? 'Production server' : 'Local development server',
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
    '/admin/test-communities': {
      get: {
        summary: 'Test ALIS Communities API',
        description:
          'Tests connectivity to the ALIS Communities API and returns all available communities. ' +
          'Protected with BasicAuth. Useful for verifying production ALIS credentials and exploring community data.',
        security: [{ basicAuth: [] }],
        tags: ['Admin'],
        responses: {
          '200': {
            description: 'Successfully retrieved communities from ALIS API.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'integer', example: 2 },
                    timestamp: { type: 'string', format: 'date-time' },
                    communities: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer', example: 123 },
                          name: { type: 'string', example: 'Sunset Senior Living' },
                          companyKey: { type: 'string', example: 'appstoresandbox' },
                          address: { type: 'string', example: '123 Main St' },
                          city: { type: 'string', example: 'Springfield' },
                          state: { type: 'string', example: 'IL' },
                          zipCode: { type: 'string', example: '62701' },
                          phone: { type: 'string', example: '555-0123' },
                        },
                      },
                    },
                  },
                },
                example: {
                  success: true,
                  count: 2,
                  timestamp: '2025-11-10T15:30:00.000Z',
                  communities: [
                    {
                      id: 123,
                      name: 'Sunset Senior Living',
                      companyKey: 'appstoresandbox',
                      address: '123 Main St',
                      city: 'Springfield',
                      state: 'IL',
                      zipCode: '62701',
                      phone: '555-0123',
                    },
                    {
                      id: 456,
                      name: 'Green Valley Care Center',
                      companyKey: 'appstoresandbox',
                      address: '456 Oak Ave',
                      city: 'Portland',
                      state: 'OR',
                      zipCode: '97201',
                      phone: '555-0456',
                    },
                  ],
                },
              },
            },
          },
          '401': {
            description: 'Basic authentication failed.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Unauthorized' },
                  },
                },
              },
            },
          },
          '500': {
            description: 'ALIS API error or internal server error.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Unauthorized to call ALIS API (401)' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/test-resident/{residentId}': {
      get: {
        summary: 'Test ALIS Resident API',
        description:
          'Fetches detailed information for a specific resident from ALIS API. ' +
          'Returns both detail and basicInfo data. Useful for debugging resident sync issues and verifying data format.',
        security: [{ basicAuth: [] }],
        tags: ['Admin'],
        parameters: [
          {
            name: 'residentId',
            in: 'path',
            required: true,
            description: 'The ALIS resident ID',
            schema: { type: 'integer', example: 12345 },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved resident data from ALIS API.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    residentId: { type: 'integer', example: 12345 },
                    timestamp: { type: 'string', format: 'date-time' },
                    data: {
                      type: 'object',
                      properties: {
                        detail: {
                          type: 'object',
                          description: 'Full resident details from ALIS',
                        },
                        basicInfo: {
                          type: 'object',
                          description: 'Basic resident info from ALIS',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid residentId parameter.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Invalid residentId parameter' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '401': { description: 'Basic authentication failed.' },
          '500': { description: 'ALIS API error or internal server error.' },
        },
      },
    },
    '/admin/test-leaves/{residentId}': {
      get: {
        summary: 'Test ALIS Leave API',
        description:
          'Fetches all leaves (temporary absences) for a specific resident from ALIS API. ' +
          'Useful for debugging leave-related events and verifying leave data structure.',
        security: [{ basicAuth: [] }],
        tags: ['Admin'],
        parameters: [
          {
            name: 'residentId',
            in: 'path',
            required: true,
            description: 'The ALIS resident ID',
            schema: { type: 'integer', example: 12345 },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved leave data from ALIS API.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    residentId: { type: 'integer', example: 12345 },
                    count: { type: 'integer', example: 2 },
                    timestamp: { type: 'string', format: 'date-time' },
                    leaves: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          LeaveId: { type: 'integer' },
                          ResidentId: { type: 'integer' },
                          StartDate: { type: 'string' },
                          ExpectedReturnDate: { type: 'string' },
                          EndDate: { type: 'string', nullable: true },
                          Reason: { type: 'string' },
                          Status: { type: 'string' },
                        },
                      },
                    },
                  },
                },
                example: {
                  success: true,
                  residentId: 12345,
                  count: 1,
                  timestamp: '2025-11-10T17:00:00.000Z',
                  leaves: [
                    {
                      LeaveId: 789,
                      ResidentId: 12345,
                      StartDate: '2025-11-05',
                      ExpectedReturnDate: '2025-11-10',
                      EndDate: null,
                      Reason: 'Hospital Visit',
                      Status: 'Active',
                    },
                  ],
                },
              },
            },
          },
          '400': { description: 'Invalid residentId parameter.' },
          '401': { description: 'Basic authentication failed.' },
          '500': { description: 'ALIS API error or internal server error.' },
        },
      },
    },
    '/admin/list-residents': {
      get: {
        summary: 'List Residents from ALIS',
        description:
          'Lists residents from ALIS API with optional filtering and pagination. ' +
          'Useful for exploring available residents, finding resident IDs, and verifying data.',
        security: [{ basicAuth: [] }],
        tags: ['Admin'],
        parameters: [
          {
            name: 'companyKey',
            in: 'query',
            required: false,
            description: 'Filter by company key (e.g., "appstoresandbox")',
            schema: { type: 'string', example: 'appstoresandbox' },
          },
          {
            name: 'communityId',
            in: 'query',
            required: false,
            description: 'Filter by community ID',
            schema: { type: 'integer', example: 123 },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number (default: 1)',
            schema: { type: 'integer', example: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            required: false,
            description: 'Number of residents per page (default: 50)',
            schema: { type: 'integer', example: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved residents list from ALIS API.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'integer', example: 2 },
                    hasMore: { type: 'boolean', example: false },
                    timestamp: { type: 'string', format: 'date-time' },
                    filters: {
                      type: 'object',
                      properties: {
                        companyKey: { type: 'string' },
                        communityId: { type: 'integer' },
                        page: { type: 'integer' },
                        pageSize: { type: 'integer' },
                      },
                    },
                    residents: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          residentId: { type: 'integer' },
                          firstName: { type: 'string' },
                          lastName: { type: 'string' },
                          status: { type: 'string' },
                          classification: { type: 'string' },
                          productType: { type: 'string' },
                          dateOfBirth: { type: 'string' },
                          rooms: {
                            type: 'array',
                            items: { type: 'object' },
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  success: true,
                  count: 2,
                  hasMore: true,
                  timestamp: '2025-11-10T17:00:00.000Z',
                  filters: {
                    companyKey: 'appstoresandbox',
                    communityId: 123,
                    page: 1,
                    pageSize: 50,
                  },
                  residents: [
                    {
                      residentId: 12345,
                      firstName: 'John',
                      lastName: 'Doe',
                      status: 'Active',
                      classification: 'Independent Living',
                      productType: 'Apartment',
                      dateOfBirth: '1950-01-15',
                      rooms: [{ roomNumber: '101', bed: 'A' }],
                    },
                  ],
                },
              },
            },
          },
          '401': { description: 'Basic authentication failed.' },
          '500': { description: 'ALIS API error or internal server error.' },
        },
      },
    },
    '/admin/webhook-events': {
      get: {
        summary: 'View Received Webhook Events',
        description:
          'Lists all webhook events received from ALIS with filtering options. ' +
          'Useful for monitoring webhook delivery, debugging event processing, and verifying event payloads.',
        security: [{ basicAuth: [] }],
        tags: ['Admin', 'Webhooks'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Maximum number of events to return (default: 50)',
            schema: { type: 'integer', example: 50 },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'Filter by event status (received, queued, processed, failed, ignored)',
            schema: {
              type: 'string',
              enum: ['received', 'queued', 'processed', 'failed', 'ignored'],
              example: 'processed',
            },
          },
          {
            name: 'eventType',
            in: 'query',
            required: false,
            description: 'Filter by event type (e.g., residents.move_in)',
            schema: { type: 'string', example: 'residents.move_in' },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved webhook events.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'integer', example: 10 },
                    timestamp: { type: 'string', format: 'date-time' },
                    filters: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        eventType: { type: 'string' },
                        limit: { type: 'integer' },
                      },
                    },
                    summary: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          status: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                    events: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          eventMessageId: { type: 'string' },
                          eventType: { type: 'string' },
                          status: { type: 'string' },
                          companyKey: { type: 'string' },
                          communityId: { type: 'integer', nullable: true },
                          receivedAt: { type: 'string', format: 'date-time' },
                          processedAt: { type: 'string', format: 'date-time', nullable: true },
                          error: { type: 'string', nullable: true },
                          payload: { type: 'object' },
                        },
                      },
                    },
                  },
                },
                example: {
                  success: true,
                  count: 2,
                  timestamp: '2025-11-13T10:00:00.000Z',
                  filters: { limit: 50 },
                  summary: [
                    { status: 'processed', count: 15 },
                    { status: 'queued', count: 3 },
                  ],
                  events: [
                    {
                      id: 1,
                      eventMessageId: 'evt_123',
                      eventType: 'residents.move_in',
                      status: 'processed',
                      companyKey: 'appstoresandbox',
                      communityId: 123,
                      receivedAt: '2025-11-13T09:00:00.000Z',
                      processedAt: '2025-11-13T09:00:05.000Z',
                      error: null,
                      payload: {
                        CompanyKey: 'appstoresandbox',
                        EventType: 'residents.move_in',
                        EventMessageId: 'evt_123',
                        NotificationData: { ResidentId: 456 },
                      },
                    },
                  ],
                },
              },
            },
          },
          '401': { description: 'Basic authentication failed.' },
          '500': { description: 'Database error or internal server error.' },
        },
      },
    },
    '/admin/webhook-events/{eventMessageId}': {
      get: {
        summary: 'Get Webhook Event Details',
        description:
          'Retrieves detailed information about a specific webhook event by its EventMessageId. ' +
          'Useful for debugging specific events and viewing complete payload data.',
        security: [{ basicAuth: [] }],
        tags: ['Admin', 'Webhooks'],
        parameters: [
          {
            name: 'eventMessageId',
            in: 'path',
            required: true,
            description: 'The unique EventMessageId from ALIS',
            schema: { type: 'string', example: 'evt_123' },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved event details.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    timestamp: { type: 'string', format: 'date-time' },
                    event: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        eventMessageId: { type: 'string' },
                        eventType: { type: 'string' },
                        status: { type: 'string' },
                        company: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer' },
                            companyKey: { type: 'string' },
                            createdAt: { type: 'string', format: 'date-time' },
                          },
                        },
                        communityId: { type: 'integer', nullable: true },
                        receivedAt: { type: 'string', format: 'date-time' },
                        processedAt: { type: 'string', format: 'date-time', nullable: true },
                        error: { type: 'string', nullable: true },
                        payload: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Event not found.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Event not found' },
                    eventMessageId: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '401': { description: 'Basic authentication failed.' },
          '500': { description: 'Database error or internal server error.' },
        },
      },
    },
    '/admin/simulate-webhook': {
      post: {
        summary: 'Simulate Webhook Event',
        description:
          'Simulates an ALIS webhook event for testing purposes. ' +
          'Creates a test event and processes it through the webhook handler. ' +
          'Useful for testing webhook processing logic without waiting for real events from ALIS.',
        security: [{ basicAuth: [] }],
        tags: ['Admin', 'Webhooks'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  eventType: {
                    type: 'string',
                    example: 'test.event',
                    description: 'Event type to simulate (default: test.event)',
                  },
                  companyKey: {
                    type: 'string',
                    example: 'TEST_COMPANY',
                    description: 'Company key for the test event (default: TEST_COMPANY)',
                  },
                  communityId: {
                    type: 'integer',
                    nullable: true,
                    example: 123,
                    description: 'Community ID for the test event (default: null)',
                  },
                  notificationData: {
                    type: 'object',
                    example: { ResidentId: 456, LeaveId: 789 },
                    description: 'Custom notification data (default: {})',
                  },
                },
              },
              example: {
                eventType: 'residents.move_in',
                companyKey: 'appstoresandbox',
                communityId: 123,
                notificationData: { ResidentId: 456 },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook simulation completed successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Webhook simulation completed' },
                    timestamp: { type: 'string', format: 'date-time' },
                    testPayload: {
                      type: 'object',
                      description: 'The payload that was sent to the webhook handler',
                    },
                    result: {
                      type: 'object',
                      description: 'Response from the webhook handler',
                    },
                  },
                },
                example: {
                  success: true,
                  message: 'Webhook simulation completed',
                  timestamp: '2025-11-13T10:30:00.000Z',
                  testPayload: {
                    CompanyKey: 'TEST_COMPANY',
                    CommunityId: null,
                    EventType: 'test.event',
                    EventMessageId: 'TEST_1699876200000_abc123',
                    EventMessageDate: '2025-11-13T10:30:00.000Z',
                    NotificationData: {},
                  },
                  result: {
                    statusCode: 202,
                    data: { status: 'test_acknowledged' },
                  },
                },
              },
            },
          },
          '401': { description: 'Basic authentication failed.' },
          '500': { description: 'Simulation failed or internal server error.' },
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
