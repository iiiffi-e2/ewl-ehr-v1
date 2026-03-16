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
          CUID: 'C-113',
          ServiceType: 'Assisted Living',
          StartDate: '2026-01-10',
          EndDate: '',
        },
        {
          PK_ID: 11,
          PatientNumber: '12345',
          CUID: 'C-113',
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
    const result = await findActiveOrLatestServiceRow({ patientNumber: '12345', cuid: 'C-113' });

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
          CUID: 'C-113',
          StartDate: '2026-01-01',
          EndDate: '2026-01-10',
        },
        {
          PK_ID: 22,
          PatientNumber: '12345',
          CUID: 'C-113',
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
    const result = await findActiveOrLatestServiceRow({ patientNumber: '12345', cuid: 'C-113' });

    expect(result.found).toBe(true);
    expect(result.id).toBe('22');
  });
});
