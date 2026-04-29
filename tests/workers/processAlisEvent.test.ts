const handleAlisEventMock = jest.fn();
const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const getCommunityEnrichmentMock = jest.fn();
const resolveAlisCredentialsMock = jest.fn();
const createAlisClientMock = jest.fn();
const fetchAllResidentDataMock = jest.fn();
const normalizeResidentMock = jest.fn();
const recordEventIssueMock = jest.fn();
const markEventProcessedMock = jest.fn();
const markEventFailedMock = jest.fn();
const upsertResidentMock = jest.fn();
const mockWorkerOn = jest.fn();
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

jest.mock('../../src/integrations/caspio/eventOrchestrator.js', () => ({
  handleAlisEvent: handleAlisEventMock,
}));

jest.mock('../../src/integrations/caspio/caspioClient.js', () => ({
  findRecordByFields: findRecordByFieldsMock,
  findByPatientNumber: findByPatientNumberMock,
}));

jest.mock('../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: getCommunityEnrichmentMock,
}));

jest.mock('../../src/integrations/alisClient.js', () => ({
  resolveAlisCredentials: resolveAlisCredentialsMock,
  createAlisClient: createAlisClientMock,
  fetchAllResidentData: fetchAllResidentDataMock,
}));

jest.mock('../../src/integrations/mappers.js', () => ({
  normalizeResident: normalizeResidentMock,
}));

jest.mock('../../src/domains/eventIssues.js', () => ({
  errorToIssueDetails: jest.fn((error: unknown) => ({ message: error instanceof Error ? error.message : String(error) })),
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

import { startProcessAlisEventWorker } from '../../src/workers/processAlisEvent.js';

describe('processAlisEvent worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerProcessor = undefined;
    resolveAlisCredentialsMock.mockResolvedValue({ username: 'user', password: 'pass' });
    createAlisClientMock.mockReturnValue({
      getResident: jest.fn().mockResolvedValue({ ResidentId: 70508 }),
      getResidentBasicInfo: jest.fn().mockResolvedValue({ FirstName: 'Ada' }),
    });
    fetchAllResidentDataMock.mockResolvedValue({
      resident: {},
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
      errors: [],
    });
    normalizeResidentMock.mockReturnValue({ residentId: 70508 });
    upsertResidentMock.mockResolvedValue(undefined);
    handleAlisEventMock.mockResolvedValue(undefined);
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
    expect(findByPatientNumberMock).toHaveBeenCalledWith('CarePatientTable_API', 70508);
    expect(handleAlisEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        EventType: 'resident.contact.updated',
        EventMessageId: 'evt-contact-updated',
      }),
      10,
      'appstoresandbox',
    );
    expect(recordEventIssueMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'caspio_patient_lookup',
        message: 'Contact event skipped because resident was not found in Caspio',
      }),
    );
  });
});
