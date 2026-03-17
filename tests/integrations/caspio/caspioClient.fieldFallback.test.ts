const mockAuthPost = jest.fn();
const mockApiPost = jest.fn();
const mockApiPut = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    isAxiosError: (error: unknown) =>
      Boolean((error as { isAxiosError?: boolean } | undefined)?.isAxiosError),
  },
}));

jest.mock('../../../src/config/axios.js', () => ({
  createHttpClient: jest
    .fn()
    .mockImplementationOnce(() => ({ post: mockAuthPost }))
    .mockImplementationOnce(() => ({ post: mockApiPost, put: mockApiPut, get: jest.fn() })),
}));

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_BASE_URL: 'https://c3aca270.caspio.com',
    CASPIO_TOKEN_URL: 'https://c3aca270.caspio.com/oauth/token',
    CASPIO_CLIENT_ID: 'test-client-id',
    CASPIO_CLIENT_SECRET: 'test-client-secret',
    CASPIO_TABLE_NAME: 'CarePatientTable_API_Temp',
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

import {
  insertRecord,
  updateRecordById,
} from '../../../src/integrations/caspio/caspioClient.js';

describe('caspioClient FieldNotFound fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthPost.mockResolvedValue({
      data: {
        access_token: 'token-1',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
  });

  it('retries insert without unsupported fields', async () => {
    const fieldNotFoundError = {
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          Code: 'FieldNotFound',
          Message:
            "Cannot perform operation because the following field(s) do not exist: 'CUID', 'CommunityName'.",
        },
      },
    };

    mockApiPost
      .mockRejectedValueOnce(fieldNotFoundError)
      .mockResolvedValueOnce({ data: { PK_ID: 9 } });

    await insertRecord('CarePatientTable_API_Temp', {
      PatientNumber: '71620',
      LastName: 'Doe',
      CUID: 'C-113',
      CommunityName: 'Test Community',
    });

    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(mockApiPost.mock.calls[1][1]).toEqual({
      PatientNumber: '71620',
      LastName: 'Doe',
    });
  });

  it('retries update without unsupported fields', async () => {
    const fieldNotFoundError = {
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          Code: 'FieldNotFound',
          Message:
            "Cannot perform operation because the following field(s) do not exist: 'CUID', 'CommunityName'.",
        },
      },
    };

    mockApiPut
      .mockRejectedValueOnce(fieldNotFoundError)
      .mockResolvedValueOnce({ data: {} });

    await updateRecordById('CarePatientTable_API_Temp', 1, {
      PatientNumber: '71620',
      FirstName: 'Jane',
      CUID: 'C-113',
      CommunityName: 'Test Community',
    });

    expect(mockApiPut).toHaveBeenCalledTimes(2);
    expect(mockApiPut.mock.calls[1][1]).toEqual({
      PatientNumber: '71620',
      FirstName: 'Jane',
    });
  });
});
