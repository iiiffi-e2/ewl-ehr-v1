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
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    CASPIO_OFF_PREM_HISTORY_TABLE_NAME: 'PatientOffPremHistory_API',
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

describe('caspioClient patient number exact matching', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('selects exact PatientNumber match from noisy API rows', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        { PK_ID: 1, PatientNumber: '11111', LastName: 'Wrong' },
        { PK_ID: 2, PatientNumber: '71667', LastName: 'Right' },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findByPatientNumber } = await import('../../../src/integrations/caspio/caspioClient.js');

    const result = await findByPatientNumber('CarePatientTable_API', '71667');
    expect(result.found).toBe(true);
    expect(result.id).toBe('2');
    expect(result.raw).toEqual(expect.objectContaining({ PatientNumber: '71667' }));
  });

  it('returns not found when paged API rows contain no exact PatientNumber', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest
      .fn()
      // string variant page 1
      .mockResolvedValueOnce({
        data: [{ PK_ID: 1, PatientNumber: '11111' }],
      })
      // numeric variant page 1
      .mockResolvedValueOnce({
        data: [{ PK_ID: 2, PatientNumber: '22222' }],
      });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findByPatientNumber } = await import('../../../src/integrations/caspio/caspioClient.js');

    const noMatch = await findByPatientNumber('CarePatientTable_API', '71667');
    expect(noMatch.found).toBe(false);
    expect(noMatch.id).toBeUndefined();
  });

  it('finds exact PatientNumber across paged where results', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const noisyPage = Array.from({ length: 200 }, (_, idx) => ({
      PK_ID: idx + 1,
      PatientNumber: String(80000 + idx),
    }));
    const mockApiGet = jest
      .fn()
      // string variant page 1
      .mockResolvedValueOnce({ data: noisyPage })
      // string variant page 2
      .mockResolvedValueOnce({ data: [{ PK_ID: 999, PatientNumber: '71667' }] })
      // numeric variant page 1
      .mockResolvedValueOnce({ data: [] });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findByPatientNumber } = await import('../../../src/integrations/caspio/caspioClient.js');

    const result = await findByPatientNumber('CarePatientTable_API', '71667');
    expect(result.found).toBe(true);
    expect(result.id).toBe('999');
    expect(result.raw).toEqual(expect.objectContaining({ PatientNumber: '71667' }));
    expect(mockApiGet).toHaveBeenCalledTimes(3);
  });
});

