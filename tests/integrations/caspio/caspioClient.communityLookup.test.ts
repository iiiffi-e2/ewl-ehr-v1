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

describe('caspioClient community lookup exact matching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('selects exact CommunityID + RoomNumber match from noisy results', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        { CommunityID: 113, RoomNumber: '48', CUID: '447', CommunityName: 'Allen' },
        { CommunityID: 113, RoomNumber: '49', CUID: '259', CommunityName: 'EyeWatch LIVE' },
        { CommunityID: 999, RoomNumber: '49', CUID: '999', CommunityName: 'Wrong Community' },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '49');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        CommunityID: 113,
        RoomNumber: '49',
        CUID: '259',
        CommunityName: 'EyeWatch LIVE',
      }),
    );
  });

  it('matches alternate field casing for community and room keys', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        { CommunityId: 113, roomNumber: '49', CUID: '259', CommunityName: 'EyeWatch LIVE' },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '49');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        CUID: '259',
        CommunityName: 'EyeWatch LIVE',
      }),
    );
  });

  it('matches keys with suffix markers from Caspio metadata', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest.fn().mockResolvedValue({
      data: [
        { 'CommunityID†': 113, 'RoomNumber ': '49', CUID: '259', CommunityName: 'EyeWatch LIVE' },
      ],
    });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '49');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        CUID: '259',
        CommunityName: 'EyeWatch LIVE',
      }),
    );
  });

  it('falls back to unfiltered scan when filtered lookup returns no rows', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest
      .fn()
      // four filtered attempts: CommunityID as number/string x RoomNumber as string/number
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      // fallback full scan
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '49', CUID: '259', CommunityName: 'EyeWatch LIVE' }],
      });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '49');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        CUID: '259',
        CommunityName: 'EyeWatch LIVE',
      }),
    );
  });

  it('falls back to unfiltered scan when filtered lookup returns noisy non-exact rows', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest
      .fn()
      // four filtered attempts return only non-exact rows
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '48', CUID: '447', CommunityName: 'Allen' }],
      })
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '48', CUID: '447', CommunityName: 'Allen' }],
      })
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '48', CUID: '447', CommunityName: 'Allen' }],
      })
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '48', CUID: '447', CommunityName: 'Allen' }],
      })
      // fallback full scan includes exact room match
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '49', CUID: '259', CommunityName: 'EyeWatch LIVE' }],
      });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '49');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        CUID: '259',
        CommunityName: 'EyeWatch LIVE',
      }),
    );
  });

  it('matches room numbers regardless of embedded spaces', async () => {
    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const mockApiGet = jest
      .fn()
      // filtered attempts miss because Caspio stores this room with a space
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      // fallback full scan includes the same room formatted differently
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '112 A', CUID: '259', CommunityName: 'EyeWatch LIVE' }],
      });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '112A');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        RoomNumber: '112 A',
        CUID: '259',
      }),
    );
  });

  it('continues lookup when one filter variant gets SQL conversion 400', async () => {
    const axios = require('axios');
    (axios.isAxiosError as jest.Mock).mockImplementation((err: unknown) => {
      return Boolean(
        err && typeof err === 'object' && 'isAxiosError' in (err as Record<string, unknown>),
      );
    });

    const mockAuthPost = jest.fn().mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
    const conversionError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          Code: 'SqlServerError',
          Message: "Conversion failed when converting the nvarchar value '104 B' to data type int.",
        },
      },
    };
    const mockApiGet = jest
      .fn()
      // CommunityID number + RoomNumber string
      .mockResolvedValueOnce({ data: [] })
      // CommunityID number + RoomNumber number (fails on mixed-type room column)
      .mockRejectedValueOnce(conversionError)
      .mockRejectedValueOnce(conversionError)
      // CommunityID string + RoomNumber string
      .mockResolvedValueOnce({
        data: [{ CommunityID: 113, RoomNumber: '49', CUID: '259', CommunityName: 'EyeWatch LIVE' }],
      })
      // CommunityID string + RoomNumber number
      .mockResolvedValueOnce({ data: [] });

    const { createHttpClient } = require('../../../src/config/axios.js');
    createHttpClient
      .mockImplementationOnce(() => ({ post: mockAuthPost }))
      .mockImplementationOnce(() => ({ get: mockApiGet, post: jest.fn(), put: jest.fn() }));

    const { findCommunityByIdAndRoomNumber } = await import(
      '../../../src/integrations/caspio/caspioClient.js'
    );

    const result = await findCommunityByIdAndRoomNumber(113, '49');
    expect(result.found).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        CUID: '259',
        CommunityName: 'EyeWatch LIVE',
      }),
    );
  });

});
