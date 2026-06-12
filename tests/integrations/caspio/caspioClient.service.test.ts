jest.mock('axios');
jest.mock('../../../src/config/axios.js', () => ({
  createHttpClient: jest.fn(),
}));
jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_BASE_URL: 'https://c3aca270.caspio.com',
    CASPIO_TOKEN_URL: 'https://c3aca270.caspio.com/oauth/token',
    CASPIO_CLIENT_ID: 'test-client-id',
    CASPIO_CLIENT_SECRET: 'test-client-secret',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    CASPIO_TIMEOUT_MS: 10000,
    CASPIO_RETRY_MAX: 3,
  },
}));
jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe('caspioClient service helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('prefers open row over newer closed row', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        {
          PK_ID: 10,
          PatientNumber: '12345',
          CUID: '259',
          ServiceType: 'Assisted Living',
          StartDate: '2026-01-10',
          EndDate: '',
        },
        {
          PK_ID: 11,
          PatientNumber: '12345',
          CUID: '259',
          ServiceType: 'Memory Care',
          StartDate: '2026-02-01',
          EndDate: '2026-02-15',
        },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findActiveOrLatestServiceRow } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await findActiveOrLatestServiceRow({ patientNumber: '12345', cuid: '259' });

    expect(result.found).toBe(true);
    expect(result.id).toBe('10');
    expect((result.record as Record<string, unknown>).ServiceType).toBe('Assisted Living');
  });

  it('falls back to latest start date when no open rows exist', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        {
          PK_ID: 21,
          PatientNumber: '12345',
          CUID: '259',
          StartDate: '2026-01-01',
          EndDate: '2026-01-10',
        },
        {
          PK_ID: 22,
          PatientNumber: '12345',
          CUID: '259',
          StartDate: '2026-03-01',
          EndDate: '2026-03-10',
        },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findActiveOrLatestServiceRow } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await findActiveOrLatestServiceRow({ patientNumber: '12345', cuid: '259' });

    expect(result.found).toBe(true);
    expect(result.id).toBe('22');
  });

  it('uses Service_ID as fallback row identifier when PK_ID is absent', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        {
          Service_ID: 406,
          PatientNumber: '71701',
          CUID: '263',
          ServiceType: 'Detect 12',
          StartDate: '03/18/2026 22:00:00',
          EndDate: '',
        },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findActiveOrLatestServiceRow } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await findActiveOrLatestServiceRow({ patientNumber: '71701', cuid: '263' });

    expect(result.found).toBe(true);
    expect(result.id).toBe('406');
    expect((result.record as Record<string, unknown>).ServiceType).toBe('Detect 12');
  });

  it('ignores noisy non-exact service rows when selecting row to close', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        // noisy row that should be ignored
        {
          Service_ID: 90,
          PatientNumber: '12345',
          CUID: '90',
          ServiceType: 'Intervene 12',
          StartDate: '2026-01-27T15:34:00',
          EndDate: '',
        },
        // exact row that should be selected
        {
          Service_ID: 406,
          PatientNumber: '71701',
          CUID: '263',
          ServiceType: 'Intervene 12',
          StartDate: '2026-03-18T22:00:00',
          EndDate: '',
        },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findActiveOrLatestServiceRow } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await findActiveOrLatestServiceRow({ patientNumber: '71701', cuid: '263' });

    expect(result.found).toBe(true);
    expect(result.id).toBe('406');
    expect((result.record as Record<string, unknown>).PatientNumber).toBe('71701');
    expect((result.record as Record<string, unknown>).CUID).toBe('263');
  });

  it('finds open service row by CUID and ServiceType without PatientNumber', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        {
          Service_ID: 501,
          CUID: '222',
          ServiceType: 'Vacant',
          StartDate: '03/01/2026 00:00:00',
          EndDate: '03/15/2026 00:00:00',
        },
        {
          Service_ID: 502,
          CUID: '222',
          ServiceType: 'Vacant',
          StartDate: '03/15/2026 00:00:00',
          EndDate: '',
        },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findOpenServiceRowByCuidAndServiceType } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await findOpenServiceRowByCuidAndServiceType({
      cuid: '222',
      serviceType: 'Vacant',
    });

    expect(result.found).toBe(true);
    expect(result.id).toBe('502');
    expect((result.record as Record<string, unknown>).PatientNumber).toBeUndefined();
  });
});
