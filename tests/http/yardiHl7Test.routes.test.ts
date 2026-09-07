import request from 'supertest';

const runYardiHl7TestMock = jest.fn();
const getYardiHl7TestConfigMock = jest.fn();

jest.mock('../../src/admin/yardiHl7Test.js', () => {
  class YardiHl7TestValidationError extends Error {
    statusCode = 400;
  }
  return {
    YardiHl7TestValidationError,
    runYardiHl7Test: (...args: unknown[]) => runYardiHl7TestMock(...args),
    getYardiHl7TestConfig: () => getYardiHl7TestConfigMock(),
  };
});

import { YardiHl7TestValidationError } from '../../src/admin/yardiHl7Test.js';
import { createApp } from '../../src/http/app.js';

const app = createApp();
const authHeader = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;

describe('Yardi HL7 test routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getYardiHl7TestConfigMock.mockReturnValue({
      pollEnabled: true,
      supportedTriggers: ['A01'],
      targets: [{ companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' }],
    });
  });

  it('requires admin auth on config', async () => {
    const response = await request(app).get('/admin/yardi-hl7-test/config');
    expect(response.status).toBe(401);
  });

  it('returns config', async () => {
    const response = await request(app)
      .get('/admin/yardi-hl7-test/config')
      .set('Authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.config.supportedTriggers).toEqual(['A01']);
  });

  it('returns 400 when the runner rejects the body', async () => {
    runYardiHl7TestMock.mockRejectedValueOnce(new YardiHl7TestValidationError('form trigger must be a supported ADT code'));
    const response = await request(app)
      .post('/admin/yardi-hl7-test/run')
      .set('Authorization', authHeader)
      .send({ source: 'form', trigger: 'A11', residentId: '1', roomNumber: '1' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('returns the runner result', async () => {
    runYardiHl7TestMock.mockResolvedValueOnce({
      success: true,
      mode: 'inline',
      event: { id: 1, eventMessageId: 'T1', eventType: 'hl7.adt.a01', status: 'processed', companyKey: 'yourlife', communityId: 113 },
      parsed: { trigger: 'A01', residentId: '418612', roomNumber: '141', facilityId: 'EYELIVE' },
      enrichment: { CUID: 'c' },
      caspio: { wrote: true, skipReason: null, operations: [] },
      issues: [],
      hl7: 'MSH|',
      jobId: null,
    });
    const response = await request(app)
      .post('/admin/yardi-hl7-test/run')
      .set('Authorization', authHeader)
      .send({ source: 'form', trigger: 'A01', residentId: '418612', roomNumber: '141' });
    expect(response.status).toBe(200);
    expect(response.body.event.eventType).toBe('hl7.adt.a01');
    expect(runYardiHl7TestMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'form', trigger: 'A01' }),
    );
  });
});
