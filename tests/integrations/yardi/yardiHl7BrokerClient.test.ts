import type { AxiosInstance } from 'axios';

import { logger } from '../../../src/config/logger.js';
import { YardiHl7BrokerClient } from '../../../src/integrations/yardi/yardiHl7BrokerClient.js';
import type { YardiHl7BrokerIdentity } from '../../../src/integrations/yardi/yardiHl7BrokerXml.js';

jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const identity: YardiHl7BrokerIdentity = {
  yardiApplicationId: 'Yardi',
  yardiFacilityId: 'EYELIVE',
  pharmacySoftwareId: 'EyeWatchLive',
  pharmacyId: 'EyeWatchLive',
  password: 'secret',
};

describe('YardiHl7BrokerClient', () => {
  const mockPost = jest.fn();
  const mockHttp = { post: mockPost } as unknown as AxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts GetMessage as text/xml and classifies ADT', async () => {
    const adt =
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5\rPID|1||1||A^B\r';
    mockPost.mockResolvedValueOnce({
      status: 200,
      data: `<HL7MessageBroker><response>${adt.replace(/&/g, '&amp;')}</response></HL7MessageBroker>`,
    });

    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity,
      http: mockHttp,
    });

    const result = await client.getMessage();
    expect(mockPost).toHaveBeenCalledWith(
      'https://example.test/GetMessage',
      expect.stringContaining('<HL7MessageBroker>'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'text/xml' }),
      }),
    );
    expect(result.kind).toBe('adt');
  });

  it('posts ProcessACK XML', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: 'ok' });
    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity,
      http: mockHttp,
    });
    await client.processAck(
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220529100022||ADT^A08|792|P|2.5\r',
    );
    expect(mockPost).toHaveBeenCalledWith(
      'https://example.test/ProcessACK/',
      expect.stringContaining('<AckCode>0</AckCode>'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'text/xml' }),
      }),
    );
  });

  it('logs diagnostics when GetMessage response is unclassified', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: '<html>blocked</html>' });
    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity,
      http: mockHttp,
    });

    const result = await client.getMessage();
    expect(result).toEqual({ kind: 'error', detail: 'missing_response' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'missing_response',
        url: 'https://example.test/GetMessage',
        bodyLength: expect.any(Number),
        bodyPreview: expect.stringContaining('blocked'),
      }),
      'yardi_hl7_get_message_unclassified',
    );
  });

  it('returns http_N error classification on non-2xx GetMessage', async () => {
    mockPost.mockResolvedValueOnce({ status: 502, data: 'bad gateway' });
    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity,
      http: mockHttp,
    });
    const result = await client.getMessage();
    expect(result).toEqual({ kind: 'error', detail: 'http_502' });
  });

  it('throws on non-2xx ProcessACK', async () => {
    mockPost.mockResolvedValueOnce({ status: 500, data: 'error' });
    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity,
      http: mockHttp,
    });
    await expect(
      client.processAck(
        'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220529100022||ADT^A08|792|P|2.5\r',
      ),
    ).rejects.toThrow(/ProcessACK failed with HTTP 500/);
  });
});
