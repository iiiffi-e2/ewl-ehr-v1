const mockFetchPatientBundle = jest.fn();

jest.mock('../../../src/integrations/yardi/yardiFhirClient.js', () => ({
  YardiFhirClient: {
    createConfigured: () => ({ fetchPatientBundle: mockFetchPatientBundle }),
    assertConfigured: jest.fn(),
  },
}));

jest.mock('../../../src/integrations/yardi/yardiFhirPollConfig.js', () => ({
  getConfiguredYardiFhirPollTargets: () => [
    { companyKey: 'yourlife', communityId: 113, organizationId: 'org-1' },
  ],
}));

import { YardiHl7AdtAdapter } from '../../../src/integrations/ehr/yardiHl7AdtAdapter.js';

const SAMPLE_YARDI_RAW = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

const FHIR_BUNDLE = {
  patientId: '418612',
  patient: {
    resourceType: 'Patient',
    id: '418612',
    active: true,
    birthDate: '1940-01-02',
    name: [{ given: ['FhirFirst'], family: 'FhirLast' }],
    meta: { lastUpdated: '2026-08-19T10:00:00Z' },
  },
  encounterBundle: {
    resourceType: 'Bundle',
    entry: [
      {
        resource: {
          resourceType: 'Encounter',
          status: 'in-progress',
          type: [{ text: 'Assisted Living' }],
          location: [{ location: { display: 'FHIR Wing, 999, B' } }],
        },
      },
    ],
  },
  coverageBundle: {
    resourceType: 'Bundle',
    entry: [
      {
        resource: {
          resourceType: 'Coverage',
          payor: [{ display: 'Example Health' }],
          subscriberId: 'policy-1',
        },
      },
    ],
  },
  conditionBundle: { resourceType: 'Bundle', entry: [] },
};

function makeEvent(companyKey = 'yourlife', communityId = 113) {
  const adapter = new YardiHl7AdtAdapter();
  const event = adapter.parseInboundEvent({
    CompanyKey: companyKey,
    CommunityId: communityId,
    EventMessageId: 'hl7-evt-1',
    EventMessageDate: '2026-04-03T12:00:00Z',
    Message: SAMPLE_YARDI_RAW,
  });
  return { adapter, event };
}

describe('YardiHl7AdtAdapter FHIR overlay', () => {
  it('overlays matching FHIR demographics while preserving HL7 workflow fields', async () => {
    mockFetchPatientBundle.mockResolvedValue(FHIR_BUNDLE);
    const { adapter, event } = makeEvent();

    const bundle = await adapter.fetchResidentBundle({
      companyId: 10,
      companyKey: 'yourlife',
      event,
      residentId: 418612,
    });

    expect(mockFetchPatientBundle).toHaveBeenCalledWith('418612');
    expect(bundle.demographics).toMatchObject({
      externalResidentId: '418612',
      firstName: 'Denise',
      lastName: 'Morgan',
      dateOfBirth: '2022-09-01T00:00:00.000Z',
      roomNumber: '141',
      bed: 'Single',
      room: '141 Single',
      classification: 'Assisted Living',
      onPrem: true,
      updatedAtUtc: '2026-04-03T12:00:00Z',
    });
    expect(bundle.vendorPayload).toMatchObject({
      fhirBundle: FHIR_BUNDLE,
    });
  });

  it('returns the HL7 bundle with an error when the FHIR overlay fails', async () => {
    mockFetchPatientBundle.mockRejectedValue(new Error('FHIR unavailable'));
    const { adapter, event } = makeEvent();

    const bundle = await adapter.fetchResidentBundle({
      companyId: 10,
      companyKey: 'yourlife',
      event,
      residentId: 418612,
    });

    expect(bundle.demographics.firstName).toBe('Denise');
    expect(bundle.demographics.roomNumber).toBe('141');
    expect(bundle.vendorPayload).toMatchObject({
      fhirOverlayError: 'FHIR unavailable',
    });
  });

  it('does not fetch FHIR when company and community are not configured', async () => {
    const { adapter, event } = makeEvent('other-company', 999);

    await adapter.fetchResidentBundle({
      companyId: 10,
      companyKey: 'other-company',
      event,
      residentId: 418612,
    });

    expect(mockFetchPatientBundle).not.toHaveBeenCalled();
  });
});
