const handleEhrEventMock = jest.fn();
const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const getCommunityEnrichmentMock = jest.fn();
const recordEventIssueMock = jest.fn();
const markEventProcessedMock = jest.fn();
const markEventFailedMock = jest.fn();
const upsertResidentMock = jest.fn();
const mockWorkerOn = jest.fn();
const requiresResidentFetchMock = jest.fn();
const resolveResidentIdMock = jest.fn();
const fetchResidentBundleMock = jest.fn();
let mockWorkerProcessor: ((job: { data: Record<string, unknown> }) => Promise<void>) | undefined;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queueName, processor) => {
    mockWorkerProcessor = processor;
    return { on: mockWorkerOn };
  }),
}));

jest.mock('../../src/config/env.js', () => ({
  env: {
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'Community_Table_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    WORKER_CONCURRENCY: 1,
    EHR_ADAPTER_ENABLED: true,
    EHR_SHADOW_MODE: false,
    ehrEnabledCommunityIds: [],
  },
}));

jest.mock('../../src/config/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/integrations/ehr/orchestrator.js', () => ({
  handleEhrEvent: handleEhrEventMock,
}));

jest.mock('../../src/integrations/ehr/registry.js', () => ({
  resolveEhrAdapter: jest.fn(() => ({
    requiresResidentFetch: requiresResidentFetchMock,
    resolveResidentId: resolveResidentIdMock,
    fetchResidentBundle: fetchResidentBundleMock,
  })),
}));

jest.mock('../../src/integrations/caspio/caspioClient.js', () => ({
  findRecordByFields: findRecordByFieldsMock,
  findByPatientNumber: findByPatientNumberMock,
}));

jest.mock('../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: getCommunityEnrichmentMock,
}));

jest.mock('../../src/domains/eventIssues.js', () => ({
  errorToIssueDetails: jest.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
  recordEventIssue: recordEventIssueMock,
}));

jest.mock('../../src/domains/events.js', () => ({
  markEventProcessed: markEventProcessedMock,
  markEventFailed: markEventFailedMock,
}));

jest.mock('../../src/domains/residents.js', () => ({
  upsertResident: upsertResidentMock,
}));

jest.mock('../../src/workers/connection.js', () => ({
  getRedisConnection: jest.fn(() => ({})),
}));

jest.mock('../../src/workers/queue.js', () => ({
  PROCESS_ALIS_EVENT_QUEUE: 'process-alis-event',
}));

import { processAlisEventJob, startProcessAlisEventWorker } from '../../src/workers/processAlisEvent.js';

describe('processAlisEvent worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerProcessor = undefined;
    requiresResidentFetchMock.mockReturnValue(true);
    resolveResidentIdMock.mockReturnValue(70508);
    fetchResidentBundleMock.mockResolvedValue({
      event: {
        source: 'alis',
        companyKey: 'appstoresandbox',
        communityId: 113,
        eventType: 'resident.contact.updated',
        eventMessageId: 'evt-contact-updated',
        eventMessageDate: '2026-04-28T12:00:00Z',
        lifecycleKind: 'contact',
        notificationData: { ResidentId: 70508 },
        raw: {},
      },
      demographics: {
        externalResidentId: '70508',
        status: 'CurrentResident',
      },
      vendorPayload: {
        fullResidentData: {
          insurance: [],
          roomAssignments: [],
          diagnosesAndAllergies: [],
          contacts: [],
          community: null,
          errors: [],
        },
      },
    });
    upsertResidentMock.mockResolvedValue(undefined);
    handleEhrEventMock.mockResolvedValue(undefined);
    markEventProcessedMock.mockResolvedValue(undefined);
    markEventFailedMock.mockResolvedValue(undefined);
    recordEventIssueMock.mockResolvedValue(undefined);
  });

  it('falls back to patient-number lookup for contact events when the community CUID misses', async () => {
    getCommunityEnrichmentMock.mockResolvedValue({ CUID: 'community-cuid' });
    findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
    findByPatientNumberMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      raw: { PatientNumber: '70508', CUID: 'room-cuid' },
    });

    startProcessAlisEventWorker();
    expect(mockWorkerProcessor).toBeDefined();

    await mockWorkerProcessor?.({
      data: {
        source: 'alis',
        eventMessageId: 'evt-contact-updated',
        eventType: 'resident.contact.updated',
        companyKey: 'appstoresandbox',
        companyId: 10,
        communityId: 113,
        notificationData: { ResidentId: 70508 },
        eventMessageDate: '2026-04-28T12:00:00Z',
      },
    });

    expect(findRecordByFieldsMock).toHaveBeenCalledWith('CarePatientTable_API', [
      { field: 'PatientNumber', value: '70508' },
      { field: 'CUID', value: 'community-cuid' },
    ]);
    expect(findByPatientNumberMock).toHaveBeenCalledWith('CarePatientTable_API', '70508');
    expect(handleEhrEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'alis',
        residentBundle: expect.anything(),
        companyId: 10,
        companyKey: 'appstoresandbox',
        event: expect.objectContaining({
          eventType: 'resident.contact.updated',
          eventMessageId: 'evt-contact-updated',
        }),
      }),
    );
    expect(recordEventIssueMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'caspio_patient_lookup',
        message: 'Contact event skipped because resident was not found in Caspio',
      }),
    );
  });

  it('rebuilds yardi-hl7 lifecycle and preserves the raw HL7 message', async () => {
    resolveResidentIdMock.mockReturnValue(418612);
    fetchResidentBundleMock.mockImplementation(async ({ event }) => ({
      event,
      demographics: {
        externalResidentId: '418612',
        status: 'CurrentResident',
      },
      vendorPayload: {
        fhirOverlayError: 'FHIR overlay unavailable',
      },
    }));

    startProcessAlisEventWorker();
    expect(mockWorkerProcessor).toBeDefined();

    await mockWorkerProcessor?.({
      data: {
        source: 'yardi-hl7',
        eventMessageId: 'evt-hl7-a01',
        eventType: 'hl7.adt.a01',
        companyKey: 'yardi-company',
        companyId: 10,
        communityId: 113,
        notificationData: { Message: 'MSH|...', ResidentId: 418612 },
        eventMessageDate: '2026-08-20T12:00:00Z',
      },
    });

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'fhir_overlay',
        severity: 'warning',
        message: 'FHIR overlay unavailable',
        retryable: false,
      }),
    );
    expect(handleEhrEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        event: expect.objectContaining({
          lifecycleKind: 'move_in',
          raw: expect.objectContaining({
            message: 'MSH|...',
          }),
        }),
      }),
    );
    expect(markEventProcessedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        eventMessageId: 'evt-hl7-a01',
      }),
    );
  });

  it('exports processAlisEventJob for inline admin runs', async () => {
    handleEhrEventMock.mockResolvedValue(undefined);
    requiresResidentFetchMock.mockReturnValue(true);
    resolveResidentIdMock.mockReturnValue(70508);
    fetchResidentBundleMock.mockResolvedValue({
      event: {
        source: 'alis',
        companyKey: 'appstoresandbox',
        communityId: 113,
        eventType: 'residents.move_in',
        eventMessageId: 'evt-inline',
        eventMessageDate: '2026-04-28T12:00:00Z',
        lifecycleKind: 'move_in',
        notificationData: { ResidentId: 70508 },
        raw: {},
      },
      demographics: { externalResidentId: '70508', status: 'CurrentResident' },
      vendorPayload: {},
    });

    await processAlisEventJob({
      source: 'alis',
      eventMessageId: 'evt-inline',
      eventType: 'residents.move_in',
      companyKey: 'appstoresandbox',
      companyId: 10,
      communityId: 113,
      notificationData: { ResidentId: 70508 },
      eventMessageDate: '2026-04-28T12:00:00Z',
    });

    expect(handleEhrEventMock).toHaveBeenCalled();
    expect(markEventProcessedMock).toHaveBeenCalledWith({
      companyId: 10,
      eventType: 'residents.move_in',
      eventMessageId: 'evt-inline',
      source: 'alis',
    });
  });
});
