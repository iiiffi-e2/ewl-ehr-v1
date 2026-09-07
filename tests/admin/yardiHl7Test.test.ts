const recordIncomingEventMock = jest.fn();
const markEventIgnoredMock = jest.fn();
const markEventQueuedMock = jest.fn();
const processAlisEventJobMock = jest.fn();
const queueAddMock = jest.fn();
const getCommunityEnrichmentMock = jest.fn();
const eventLogFindFirstMock = jest.fn();
const eventLogFindUniqueMock = jest.fn();
const issueFindManyMock = jest.fn();
const resolveYardiHl7FacilityMock = jest.fn();
const getConfiguredYardiHl7PollTargetsMock = jest.fn();

jest.mock('../../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    YARDI_HL7_POLL_ENABLED: true,
    YARDI_HL7_POLL_INTERVAL_MS: 300000,
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    EHR_ADAPTER_ENABLED: true,
    EHR_SHADOW_MODE: false,
    ehrEnabledCommunityIds: [],
  },
}));

jest.mock('../../src/domains/events.js', () => ({
  recordIncomingEvent: (...args: unknown[]) => recordIncomingEventMock(...args),
  markEventIgnored: (...args: unknown[]) => markEventIgnoredMock(...args),
  markEventQueued: (...args: unknown[]) => markEventQueuedMock(...args),
}));

jest.mock('../../src/workers/processAlisEvent.js', () => ({
  processAlisEventJob: (...args: unknown[]) => processAlisEventJobMock(...args),
}));

jest.mock('../../src/workers/queue.js', () => ({
  processAlisEventQueue: { add: (...args: unknown[]) => queueAddMock(...args) },
}));

jest.mock('../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: (...args: unknown[]) => getCommunityEnrichmentMock(...args),
}));

jest.mock('../../src/integrations/yardi/yardiHl7PollConfig.js', () => ({
  getConfiguredYardiHl7PollTargets: () => getConfiguredYardiHl7PollTargetsMock(),
  resolveYardiHl7Facility: (...args: unknown[]) => resolveYardiHl7FacilityMock(...args),
}));

jest.mock('../../src/db/prisma.js', () => ({
  prisma: {
    eventLog: {
      findFirst: (...args: unknown[]) => eventLogFindFirstMock(...args),
      findUnique: (...args: unknown[]) => eventLogFindUniqueMock(...args),
    },
    eventProcessingIssue: {
      findMany: (...args: unknown[]) => issueFindManyMock(...args),
    },
  },
}));

import { YardiHl7TestValidationError, runYardiHl7Test } from '../../src/admin/yardiHl7Test.js';

const SAMPLE_HL7 = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

function mockPersistedEvent(eventMessageId: string) {
  const eventLog = {
    id: 99,
    eventMessageId,
    eventType: 'hl7.adt.a01',
    status: 'received',
    communityId: 113,
    error: null,
    payload: {},
  };
  recordIncomingEventMock.mockResolvedValue({
    eventLog,
    company: { id: 10, companyKey: 'yourlife' },
    isDuplicate: false,
  });
  eventLogFindUniqueMock.mockResolvedValue({
    ...eventLog,
    status: 'processed',
    company: { companyKey: 'yourlife' },
  });
  issueFindManyMock.mockResolvedValue([]);
  getCommunityEnrichmentMock.mockResolvedValue({
    CUID: 'cuid-141',
    CommunityName: 'EyeWatch Live',
  });
}

describe('runYardiHl7Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConfiguredYardiHl7PollTargetsMock.mockReturnValue([
      { companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' },
    ]);
    resolveYardiHl7FacilityMock.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });
    processAlisEventJobMock.mockResolvedValue(undefined);
    markEventIgnoredMock.mockResolvedValue(undefined);
    markEventQueuedMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue({ id: 'job-1' });
  });

  it('rejects form trigger that is not supported', async () => {
    await expect(
      runYardiHl7Test({
        mode: 'inline',
        source: 'form',
        trigger: 'A11',
        residentId: '1',
        roomNumber: '141',
        facilityId: 'EYELIVE',
      }),
    ).rejects.toBeInstanceOf(YardiHl7TestValidationError);
    expect(recordIncomingEventMock).not.toHaveBeenCalled();
  });

  it('rejects dry-run plus enqueue', async () => {
    await expect(
      runYardiHl7Test({
        mode: 'dry-run',
        source: 'hl7',
        hl7: SAMPLE_HL7,
        enqueue: true,
      }),
    ).rejects.toBeInstanceOf(YardiHl7TestValidationError);
    expect(recordIncomingEventMock).not.toHaveBeenCalled();
  });

  it('rejects eventLog replay for non yardi-hl7 rows', async () => {
    eventLogFindFirstMock.mockResolvedValue({
      id: 1,
      source: 'alis',
      payload: { notificationData: { Message: SAMPLE_HL7 } },
    });
    await expect(
      runYardiHl7Test({ mode: 'inline', source: 'eventLog', eventLogId: 1 }),
    ).rejects.toBeInstanceOf(YardiHl7TestValidationError);
    expect(recordIncomingEventMock).not.toHaveBeenCalled();
  });

  it('runs inline form A01 through processAlisEventJob with a new message id', async () => {
    mockPersistedEvent('Tplaceholder');
    recordIncomingEventMock.mockImplementation(async (event: any) => {
      mockPersistedEvent(event.eventMessageId);
      return {
        eventLog: { id: 99, eventMessageId: event.eventMessageId, eventType: event.eventType ?? 'hl7.adt.a01', status: 'received', communityId: 113, error: null, payload: {} },
        company: { id: 10, companyKey: 'yourlife' },
        isDuplicate: false,
      };
    });
    const result = await runYardiHl7Test({
      mode: 'inline',
      source: 'form',
      trigger: 'A01',
      residentId: '418612',
      roomNumber: '141',
      facilityId: 'EYELIVE',
    });
    expect(result.success).toBe(true);
    expect(result.event.eventMessageId).not.toBe('10529');
    expect(processAlisEventJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        eventType: 'hl7.adt.a01',
        companyKey: 'yourlife',
        communityId: 113,
      }),
    );
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('marks dry-run ignored and does not enqueue', async () => {
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
      eventLog: {
        id: 99,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: 'received',
        communityId: 113,
        error: null,
        payload: {},
      },
      company: { id: 10, companyKey: 'yourlife' },
      isDuplicate: false,
    }));
    eventLogFindUniqueMock.mockImplementation(async () => ({
      id: 99,
      eventMessageId: 'x',
      eventType: 'hl7.adt.a01',
      status: 'ignored',
      communityId: 113,
      error: 'dry_run',
      payload: {},
      company: { companyKey: 'yourlife' },
    }));
    issueFindManyMock.mockResolvedValue([]);
    getCommunityEnrichmentMock.mockResolvedValue({ CUID: 'cuid-141', CommunityName: 'EyeWatch Live' });

    const result = await runYardiHl7Test({
      mode: 'dry-run',
      source: 'hl7',
      hl7: SAMPLE_HL7,
    });
    expect(processAlisEventJobMock).toHaveBeenCalled();
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7' }),
      'dry_run',
    );
    expect(result.caspio.wrote).toBe(false);
    expect(result.caspio.skipReason).toBe('dry_run');
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('enqueues with the poller jobId shape', async () => {
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
      eventLog: {
        id: 99,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: 'queued',
        communityId: 113,
        error: null,
        payload: {},
      },
      company: { id: 10, companyKey: 'yourlife' },
      isDuplicate: false,
    }));
    eventLogFindUniqueMock.mockResolvedValue({
      id: 99,
      eventMessageId: 'x',
      eventType: 'hl7.adt.a01',
      status: 'queued',
      communityId: 113,
      error: null,
      payload: {},
      company: { companyKey: 'yourlife' },
    });
    issueFindManyMock.mockResolvedValue([]);
    getCommunityEnrichmentMock.mockResolvedValue({ CUID: 'cuid-141' });

    const result = await runYardiHl7Test({
      mode: 'enqueue',
      source: 'hl7',
      hl7: SAMPLE_HL7,
    });
    expect(processAlisEventJobMock).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith(
      'process-alis-event',
      expect.objectContaining({ source: 'yardi-hl7', eventType: 'hl7.adt.a01' }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^event-yardi-hl7-hl7\.adt\.a01-/),
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
    expect(result.jobId).toBe('job-1');
    expect(result.caspio.operations).toEqual([]);
    expect(result.caspio.wrote).toBe(false);
  });

  it('ignores unknown facility without calling the worker', async () => {
    resolveYardiHl7FacilityMock.mockReturnValue(null);
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
      eventLog: {
        id: 99,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: 'ignored',
        communityId: null,
        error: 'unknown_facility',
        payload: {},
      },
      company: { id: 10, companyKey: 'yardi' },
      isDuplicate: false,
    }));
    eventLogFindUniqueMock.mockResolvedValue({
      id: 99,
      eventMessageId: 'x',
      eventType: 'hl7.adt.a01',
      status: 'ignored',
      communityId: null,
      error: 'unknown_facility',
      payload: {},
      company: { companyKey: 'yardi' },
    });
    issueFindManyMock.mockResolvedValue([]);

    const result = await runYardiHl7Test({
      mode: 'inline',
      source: 'hl7',
      hl7: SAMPLE_HL7,
    });
    expect(markEventIgnoredMock).toHaveBeenCalledWith(expect.anything(), 'unknown_facility');
    expect(processAlisEventJobMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.caspio.skipReason).toBe('unknown_facility');
  });
});
