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
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
  },
}));

jest.mock('../../src/db/prisma.js', () => ({
  prisma: {
    company: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../src/integrations/yardi/yardiFhirPollCursor.js', () => ({
  createRedisSyncCursorStore: jest.fn(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  })),
}));

const runYardiFhirSyncForTargetMock = jest.fn();
jest.mock('../../src/integrations/yardi/yardiFhirSync.js', () => ({
  runYardiFhirSyncForTarget: runYardiFhirSyncForTargetMock,
}));

jest.mock('../../src/config/axios.js', () => ({
  createHttpClient: createHttpClientMock,
}));

import {
  executeYardiFhirGetRequest,
  normalizeQueryParams,
  parseYardiFhirTestSyncInput,
  runYardiFhirTestSync,
  testYardiFhirAuthentication,
  validateYardiFhirPath,
} from '../../src/admin/yardiFhirTest.js';
import { prisma } from '../../src/db/prisma.js';

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

  it('returns API error payload for failed FHIR requests', async () => {
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

  it('parses sync input from request body', () => {
    expect(
      parseYardiFhirTestSyncInput({
        companyKey: 'eyewatch',
        communityId: '237',
        organizationId: '237-1',
        skipCaspio: true,
      }),
    ).toEqual({
      companyKey: 'eyewatch',
      communityId: 237,
      organizationId: '237-1',
      skipCaspio: true,
      skipService: true,
    });
  });

  it('allows service table writes when explicitly requested', () => {
    expect(
      parseYardiFhirTestSyncInput({
        companyKey: 'eyewatch',
        communityId: 237,
        organizationId: '237-1',
        skipCaspio: false,
        skipService: false,
      }),
    ).toEqual({
      companyKey: 'eyewatch',
      communityId: 237,
      organizationId: '237-1',
      skipCaspio: false,
      skipService: false,
    });
  });

  it('rejects invalid sync input', () => {
    expect(() => parseYardiFhirTestSyncInput({ companyKey: 'eyewatch' })).toThrow(
      'companyKey, communityId, and organizationId are required',
    );
  });

  it('runs sync for an existing company', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValueOnce({ id: 1, companyKey: 'eyewatch' });
    runYardiFhirSyncForTargetMock.mockResolvedValueOnce({
      companyKey: 'eyewatch',
      communityId: 237,
      organizationId: '237-1',
      startedAt: '2026-06-12T00:00:00.000Z',
      completedAt: '2026-06-12T00:00:01.000Z',
      patientsDiscovered: 3,
      patientsProcessed: 3,
      patientsSucceeded: 3,
      patientsFailed: 0,
      errors: [],
    });

    const summary = await runYardiFhirTestSync({
      companyKey: 'eyewatch',
      communityId: 237,
      organizationId: '237-1',
      skipCaspio: false,
      skipService: true,
    });

    expect(summary.patientsSucceeded).toBe(3);
    expect(runYardiFhirSyncForTargetMock).toHaveBeenCalledWith(
      {
        companyKey: 'eyewatch',
        communityId: 237,
        organizationId: '237-1',
      },
      expect.objectContaining({
        skipCaspio: false,
        skipService: true,
        includeDetails: true,
      }),
    );
  });

  it('throws when sync company is missing', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      runYardiFhirTestSync({
        companyKey: 'missing',
        communityId: 237,
        organizationId: '237-1',
        skipCaspio: false,
        skipService: true,
      }),
    ).rejects.toThrow("Company not found for key 'missing'");
  });
});
