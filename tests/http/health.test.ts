import request from 'supertest';

const verifyAlisConnectivityMock = jest.fn();
const redisPingMock = jest.fn().mockResolvedValue('PONG');

jest.mock('../../src/integrations/alisClient.js', () => {
  const actual = jest.requireActual('../../src/integrations/alisClient.js');
  return {
    ...actual,
    verifyAlisConnectivity: verifyAlisConnectivityMock,
  };
});

jest.mock('../../src/workers/connection.js', () => {
  const actual = jest.requireActual('../../src/workers/connection.js');
  return {
    ...actual,
    getRedisConnection: () => ({
      ping: redisPingMock,
      quit: jest.fn(),
    }),
  };
});

import { prisma } from '../../src/db/prisma.js';
import { createApp } from '../../src/http/app.js';

describe('Health endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    verifyAlisConnectivityMock.mockReset();
    redisPingMock.mockClear();
  });

  it('returns ok for /health', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns dependency status for /health/deps', async () => {
    const dbSpy = jest.spyOn(prisma, '$queryRaw').mockResolvedValueOnce(1 as never);

    const response = await request(app).get('/health/deps');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      alis: 'ok',
      database: 'ok',
      redis: 'ok',
    });

    expect(verifyAlisConnectivityMock).toHaveBeenCalled();
    expect(redisPingMock).toHaveBeenCalled();
    expect(dbSpy).toHaveBeenCalled();

    dbSpy.mockRestore();
  });
});
