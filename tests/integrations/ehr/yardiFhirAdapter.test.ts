const postMock = jest.fn();
const getMock = jest.fn();
const createHttpClientMock = jest.fn();

jest.mock('../../../src/config/env.js', () => ({
  env: {
    YARDI_FHIR_TOKEN_URL: 'https://example.com/identity/connect/token',
    YARDI_FHIR_API_BASE_URL: 'https://example.com/fhir/r4',
    YARDI_FHIR_CLIENT_ID: 'client-id',
    YARDI_FHIR_CLIENT_SECRET: 'client-secret',
    YARDI_FHIR_SCOPE: 'APIvR4',
  },
}));

jest.mock('../../../src/config/axios.js', () => ({
  createHttpClient: createHttpClientMock,
}));

import { YardiFhirAdapter } from '../../../src/integrations/ehr/yardiFhirAdapter.js';

describe('YardiFhirAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createHttpClientMock
      .mockReturnValueOnce({ post: postMock })
      .mockReturnValue({ get: getMock });

    postMock.mockResolvedValue({
      data: {
        access_token: 'token-123',
        expires_in: 300,
      },
    });

    getMock.mockImplementation((url: string) => {
      if (url.startsWith('/Patient/70508')) {
        return Promise.resolve({
          data: {
            resourceType: 'Patient',
            id: '70508',
            active: true,
            birthDate: '1944-02-10',
            name: [{ family: 'Doe', given: ['Jane'] }],
          },
        });
      }
      if (url.startsWith('/Encounter') || url.startsWith('/Coverage') || url.startsWith('/Condition')) {
        return Promise.resolve({
          data: {
            resourceType: 'Bundle',
            entry: [],
          },
        });
      }
      throw new Error(`Unexpected GET URL ${url}`);
    });
  });

  it('parses inbound payload and fetches canonical patient demographics', async () => {
    const adapter = new YardiFhirAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'yardi-company',
      CommunityId: 113,
      EventType: 'patient.updated',
      EventMessageId: 'fhir-evt-1',
      EventMessageDate: '2026-04-03T12:00:00Z',
      NotificationData: {
        PatientId: 70508,
      },
    });

    const residentId = adapter.resolveResidentId({ event });
    const bundle = await adapter.fetchResidentBundle({
      companyId: 10,
      companyKey: 'yardi-company',
      event,
      residentId,
    });

    expect(postMock).toHaveBeenCalled();
    expect(getMock).toHaveBeenCalledWith('/Patient/70508');
    expect(bundle.demographics).toMatchObject({
      externalResidentId: '70508',
      firstName: 'Jane',
      lastName: 'Doe',
      status: 'active',
      dateOfBirth: '1944-02-10T00:00:00.000Z',
    });
  });

  it('accepts string FHIR patient ids', () => {
    const adapter = new YardiFhirAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'yardi-company',
      EventType: 'patient.updated',
      EventMessageId: 'fhir-evt-2',
      EventMessageDate: '2026-04-03T12:00:00Z',
      NotificationData: {
        PatientId: '5881-2',
      },
    });

    expect(adapter.resolveResidentId({ event })).toBe('5881-2');
  });
});
