import request from 'supertest';

const queueAddMock = jest.fn();
const recordIncomingEventMock = jest.fn();
const markEventQueuedMock = jest.fn();
const markEventIgnoredMock = jest.fn();

jest.mock('../../src/workers/queue.js', () => ({
  processAlisEventQueue: {
    add: queueAddMock,
  },
}));

jest.mock('../../src/domains/events.js', () => ({
  recordIncomingEvent: recordIncomingEventMock,
  markEventQueued: markEventQueuedMock,
  markEventIgnored: markEventIgnoredMock,
}));

import { createApp } from '../../src/http/app.js';

const app = createApp();
const authHeader = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;

describe('POST /webhook/alis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when missing basic auth', async () => {
    const response = await request(app).post('/webhook/alis').send({});
    expect(response.status).toBe(401);
  });

  it('validates payload and returns 400 for invalid input', async () => {
    const response = await request(app)
      .post('/webhook/alis')
      .set('Authorization', authHeader)
      .send({ invalid: true });

    expect(response.status).toBe(400);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('returns 202 and enqueues job for supported event', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 123 },
      company: { id: 10, companyKey: 'appstoresandbox' },
      isDuplicate: false,
    });

    queueAddMock.mockResolvedValueOnce(undefined);
    markEventQueuedMock.mockResolvedValueOnce(undefined);

    const payload = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 321,
      EventType: 'residents.move_in',
      EventMessageId: 'evt-123',
      EventMessageDate: new Date().toISOString(),
      NotificationData: {
        ResidentId: 456,
      },
    };

    const response = await request(app)
      .post('/webhook/alis')
      .set('Authorization', authHeader)
      .send(payload);

    expect(response.status).toBe(202);
    expect(queueAddMock).toHaveBeenCalledWith(
      'process-alis-event',
      expect.objectContaining({
        eventMessageId: 'evt-123',
        companyId: 10,
      }),
      expect.objectContaining({ jobId: 'evt-123' }),
    );
    expect(markEventQueuedMock).toHaveBeenCalledWith('evt-123');
  });

  it('returns 200 when event is duplicate', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 123 },
      company: { id: 10, companyKey: 'appstoresandbox' },
      isDuplicate: true,
    });

    const payload = {
      CompanyKey: 'appstoresandbox',
      EventType: 'residents.move_in',
      EventMessageId: 'evt-duplicated',
      EventMessageDate: new Date().toISOString(),
    };

    const response = await request(app)
      .post('/webhook/alis')
      .set('Authorization', authHeader)
      .send(payload);

    expect(response.status).toBe(200);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('marks unsupported events as ignored', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 123 },
      company: { id: 10, companyKey: 'appstoresandbox' },
      isDuplicate: false,
    });

    markEventIgnoredMock.mockResolvedValueOnce(undefined);

    const payload = {
      CompanyKey: 'appstoresandbox',
      EventType: 'unsupported.event',
      EventMessageId: 'evt-unsupported',
      EventMessageDate: new Date().toISOString(),
    };

    const response = await request(app)
      .post('/webhook/alis')
      .set('Authorization', authHeader)
      .send(payload);

    expect(response.status).toBe(202);
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      'evt-unsupported',
      expect.stringContaining('Unsupported event type'),
    );
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});
