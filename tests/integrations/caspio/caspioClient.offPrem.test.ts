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

describe('caspioClient off-prem helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('findOpenOffPremEpisode falls back when Leave_ID specific match is absent', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest
      .fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ PK_ID: 11, PatientNumber: '12345', CUID: '259', IsOpen: true, OffPremStart: '2026-01-19T13:00:00' }],
      });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findOpenOffPremEpisode } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await findOpenOffPremEpisode({
      patientNumber: '12345',
      cuid: '259',
      leaveId: 285,
    });

    expect(result.found).toBe(true);
    expect(result.id).toBe('11');
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it('upsertOffPremEpisodeByEpisodeId writes by Episode_ID', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({ data: [] });
    const mockApiPost = jest.fn().mockResolvedValue({ data: { PK_ID: 22 } });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: mockApiPost, put: jest.fn() }));

    const { upsertOffPremEpisodeByEpisodeId } = await import('../../../src/integrations/caspio/caspioClient.js');
    const result = await upsertOffPremEpisodeByEpisodeId({
      Episode_ID: 'leave:12345:259:285',
      PatientNumber: '12345',
      CUID: '259',
      OffPremStart: '2026-01-19T13:00:00',
      IsOpen: true,
      StartEventMessageId: 'evt-1',
      SourceSystem: 'ALIS',
      CreatedAtUtc: '2026-01-19T13:00:00Z',
      UpdatedAtUtc: '2026-01-19T13:00:00Z',
    });

    expect(result).toEqual({ action: 'insert', id: '22' });
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });
});
