jest.mock('axios', () => ({
  ...jest.requireActual('axios'),
  isAxiosError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError),
}));
const postMock = jest.fn();
const getMock = jest.fn();
const createHttpClientMock = jest.fn();

jest.mock('../../src/config/env.js', () => ({
  env: {
    YARDI_FHIR_TOKEN_URL: 'https://example.com/identity/connect/token',
    YARDI_FHIR_API_BASE_URL: 'https://example.com/fhir/r4/',
    YARDI_FHIR_CLIENT_ID: 'client-id',
    YARDI_FHIR_CLIENT_SECRET: 'client-secret',
    YARDI_FHIR_SCOPE: 'APIvR4',
    YARDI_FHIR_POLL_ENABLED: false,
    YARDI_FHIR_POLL_INTERVAL_MS: 14400000,
    YARDI_FHIR_POLL_TARGETS: undefined,
  },
}));

jest.mock('../../src/config/axios.js', () => ({
  createHttpClient: createHttpClientMock,
}));

import {
  executeYardiFhirGetRequest,
  normalizeQueryParams,
  testYardiFhirAuthentication,
  validateYardiFhirPath,
} from '../../src/admin/yardiFhirTest.js';

describe('yardiFhirTest admin helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createHttpClientMock.mockImplementation((config?: { headers?: Record<string, string> }) => {
      if (config?.headers?.['Content-Type'] === 'application/x-www-form-urlencoded') {
        return { post: postMock };
      }
      return { get: getMock };
    });

    postMock.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'token-123',
        expires_in: 300,
        token_type: 'Bearer',
      },
    });

    getMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/fhir+json' },
      data: {
        resourceType: 'Bundle',
        total: 0,
        entry: [],
      },
    });
  });

  it('validates FHIR paths', () => {
    expect(validateYardiFhirPath('/Patient')).toBe('/Patient');
    expect(() => validateYardiFhirPath('/Patient/../secret')).toThrow('Path must not contain ..');
  });

  it('normalizes query params', () => {
    expect(normalizeQueryParams({ active: 'true', _count: 5, empty: '' })).toEqual({
      active: 'true',
      _count: '5',
    });
  });

  it('tests authentication against the token endpoint', async () => {
    const result = await testYardiFhirAuthentication();
    expect(result.status).toBe(200);
    expect(result.response.access_token).toBe('token-123');
    expect(postMock).toHaveBeenCalled();
  });

  it('executes authorized FHIR GET requests', async () => {
    const result = await executeYardiFhirGetRequest('/Patient', { active: 'true', _count: 5 });
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith('/Patient', {
      params: { active: 'true', _count: '5' },
    });
  });

  it('returns API error payloads for failed FHIR requests', async () => {
    getMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 404',
      response: {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        data: {
          resourceType: 'OperationOutcome',
          issue: [{ diagnostics: 'Unknown resource' }],
        },
      },
    });

    const result = await executeYardiFhirGetRequest('/Patient/missing', undefined);
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.data).toMatchObject({
      resourceType: 'OperationOutcome',
    });
  });
});
