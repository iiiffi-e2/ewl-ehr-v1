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
        source: 'alis',
        eventMessageId: 'evt-123',
        eventType: 'residents.move_in',
        companyId: 10,
      }),
      expect.objectContaining({ jobId: 'event-alis-residents.move_in-evt-123' }),
    );
    expect(markEventQueuedMock).toHaveBeenCalledWith({
      companyId: 10,
      eventType: 'residents.move_in',
      eventMessageId: 'evt-123',
      source: 'alis',
    });
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
      {
        companyId: 10,
        eventType: 'unsupported.event',
        eventMessageId: 'evt-unsupported',
        source: 'alis',
      },
      expect.stringContaining('Unsupported event type'),
    );
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});

const SAMPLE_YARDI_HL7 = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('POST /webhook/yardi/hl7', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures raw HL7, does not enqueue, returns HL7 ACK', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 501 },
      company: { id: 20, companyKey: 'yardi' },
      isDuplicate: false,
    });
    markEventIgnoredMock.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .set('Content-Type', 'text/plain')
      .send(SAMPLE_YARDI_HL7);

    expect(response.status).toBe(202);
    expect(response.text).toContain('MSA|AA|10529');
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 20,
        eventMessageId: '10529',
        source: 'yardi-hl7',
      }),
      'capture_only',
    );
    expect(recordIncomingEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        companyKey: 'yardi',
        eventMessageId: '10529',
      }),
    );
  });

  it('captures JSON envelope without enqueueing and returns JSON', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 502 },
      company: { id: 20, companyKey: 'yardi-company' },
      isDuplicate: false,
    });
    markEventIgnoredMock.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .send({
        CompanyKey: 'yardi-company',
        CommunityId: 113,
        EventMessageId: 'json-1',
        EventMessageDate: '2026-04-03T12:00:00Z',
        Message: SAMPLE_YARDI_HL7,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'received', id: 502 });
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventMessageId: 'json-1', source: 'yardi-hl7' }),
      'capture_only',
    );
  });

  it('returns HL7 AE ACK for invalid raw body', async () => {
    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .set('Content-Type', 'text/plain')
      .send('not-a-message');

    expect(response.status).toBe(400);
    expect(response.text).toContain('MSA|AE|');
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('returns HL7 AA ACK for duplicate raw HL7 without enqueueing', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 503 },
      company: { id: 20, companyKey: 'yardi' },
      isDuplicate: true,
    });

    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .set('Content-Type', 'text/plain')
      .send(SAMPLE_YARDI_HL7);

    expect(response.status).toBe(200);
    expect(response.text).toContain('MSA|AA|10529');
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});
