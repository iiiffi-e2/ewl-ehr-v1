const addMock = jest.fn();
const drainYardiHl7MailboxMock = jest.fn();
const forFacilityMock = jest.fn();
const mockWorkerOn = jest.fn();
const getConfiguredYardiHl7PollTargetsMock = jest.fn();
let mockWorkerProcessor: ((job: { id?: string; data: Record<string, never> }) => Promise<void>) | undefined;

const envState = {
  YARDI_HL7_POLL_ENABLED: false,
  YARDI_HL7_POLL_INTERVAL_MS: 300_000,
  YARDI_HL7_POLL_MAX_MESSAGES: 50,
  YARDI_HL7_MAILBOX_PASSWORD: undefined as string | undefined,
  YARDI_HL7_SENDING_FACILITY: 'EYELIVE',
};

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queueName, processor) => {
    mockWorkerProcessor = processor;
    return { on: mockWorkerOn };
  }),
}));

jest.mock('../../src/config/env.js', () => ({
  env: envState,
}));

jest.mock('../../src/config/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/workers/connection.js', () => ({
  getRedisConnection: jest.fn(() => ({})),
}));

const getRepeatableJobsMock = jest.fn();
const removeRepeatableByKeyMock = jest.fn();

jest.mock('../../src/workers/queue.js', () => ({
  YARDI_HL7_POLL_QUEUE: 'yardi-hl7-poll',
  yardiHl7PollQueue: {
    add: addMock,
    getRepeatableJobs: getRepeatableJobsMock,
    removeRepeatableByKey: removeRepeatableByKeyMock,
  },
}));

jest.mock('../../src/integrations/yardi/yardiHl7BrokerClient.js', () => ({
  YardiHl7BrokerClient: {
    forFacility: forFacilityMock,
  },
}));

jest.mock('../../src/integrations/yardi/yardiHl7PollCapture.js', () => ({
  drainYardiHl7Mailbox: drainYardiHl7MailboxMock,
}));

jest.mock('../../src/integrations/yardi/yardiHl7PollConfig.js', () => ({
  getConfiguredYardiHl7PollTargets: getConfiguredYardiHl7PollTargetsMock,
}));

import { logger } from '../../src/config/logger.js';
import {
  registerYardiHl7PollSchedule,
  startYardiHl7PollWorker,
} from '../../src/workers/yardiHl7Poll.js';

describe('yardiHl7Poll worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerProcessor = undefined;
    envState.YARDI_HL7_POLL_ENABLED = false;
    envState.YARDI_HL7_POLL_INTERVAL_MS = 300_000;
    envState.YARDI_HL7_POLL_MAX_MESSAGES = 50;
    envState.YARDI_HL7_MAILBOX_PASSWORD = undefined;
    addMock.mockResolvedValue(undefined);
    getRepeatableJobsMock.mockResolvedValue([]);
    removeRepeatableByKeyMock.mockResolvedValue(undefined);
    getConfiguredYardiHl7PollTargetsMock.mockReturnValue([
      { companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' },
    ]);
    drainYardiHl7MailboxMock.mockResolvedValue({
      captured: 0,
      duplicates: 0,
      errors: 0,
      empty: true,
    });
    forFacilityMock.mockImplementation((facilityId: string) => ({
      facilityId,
      getMessage: jest.fn(),
      processAck: jest.fn(),
    }));
  });

  it('register does not add when disabled', async () => {
    envState.YARDI_HL7_POLL_ENABLED = false;

    await registerYardiHl7PollSchedule();

    expect(addMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('yardi_hl7_poll_schedule_disabled');
  });

  it('register does not add when enabled without mailbox password', async () => {
    envState.YARDI_HL7_POLL_ENABLED = true;
    envState.YARDI_HL7_MAILBOX_PASSWORD = undefined;

    await registerYardiHl7PollSchedule();

    expect(addMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('yardi_hl7_poll_enabled_without_mailbox_password');
  });

  it('register adds when enabled with password', async () => {
    envState.YARDI_HL7_POLL_ENABLED = true;
    envState.YARDI_HL7_MAILBOX_PASSWORD = 'secret';
    envState.YARDI_HL7_POLL_INTERVAL_MS = 60_000;

    await registerYardiHl7PollSchedule();

    expect(addMock).toHaveBeenCalledWith(
      'yardi-hl7-poll-scheduled',
      {},
      {
        jobId: 'yardi-hl7-poll-repeat',
        repeat: {
          every: 60_000,
        },
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    expect(logger.info).toHaveBeenCalledWith(
      {
        intervalMs: 60_000,
        maxMessages: 50,
        targetCount: 1,
        facilityIds: ['EYELIVE'],
      },
      'yardi_hl7_poll_schedule_registered',
    );
  });

  it('warns but registers when enabled without targets', async () => {
    envState.YARDI_HL7_POLL_ENABLED = true;
    envState.YARDI_HL7_MAILBOX_PASSWORD = 'secret';
    getConfiguredYardiHl7PollTargetsMock.mockReturnValue([]);

    await registerYardiHl7PollSchedule();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        hasTargetsEnv: false,
        targetsEnvLength: 0,
      }),
      'yardi_hl7_poll_enabled_without_targets',
    );
    expect(addMock).toHaveBeenCalled();
  });

  it('processJob drains the roster facility mailbox', async () => {
    envState.YARDI_HL7_POLL_MAX_MESSAGES = 25;

    startYardiHl7PollWorker();
    expect(mockWorkerProcessor).toBeDefined();

    await mockWorkerProcessor!({ id: 'job-1', data: {} });

    expect(forFacilityMock).toHaveBeenCalledWith('EYELIVE');
    expect(drainYardiHl7MailboxMock).toHaveBeenCalledWith({
      client: expect.objectContaining({ facilityId: 'EYELIVE' }),
      maxMessages: 25,
    });
  });

  it('processJob drains each distinct roster mailbox and continues after a failure', async () => {
    getConfiguredYardiHl7PollTargetsMock.mockReturnValue([
      { companyKey: 'eyewatch', communityId: 237, facilityId: 'EYELIVE' },
      { companyKey: 'srifayetteville', communityId: 20, facilityId: 'LNGFAY' },
      { companyKey: '3rivers', communityId: 28, facilityId: 'CRKTHREE' },
      { companyKey: 'srifayetteville', communityId: 20, facilityId: 'lngfay' },
    ]);
    drainYardiHl7MailboxMock
      .mockResolvedValueOnce({ captured: 1, duplicates: 0, errors: 0, empty: true })
      .mockRejectedValueOnce(new Error('broker down'))
      .mockResolvedValueOnce({ captured: 0, duplicates: 0, errors: 0, empty: true });

    startYardiHl7PollWorker();

    await expect(mockWorkerProcessor!({ id: 'job-2', data: {} })).rejects.toThrow(/LNGFAY/);

    expect(forFacilityMock.mock.calls.map((call) => call[0])).toEqual([
      'EYELIVE',
      'LNGFAY',
      'CRKTHREE',
    ]);
    expect(drainYardiHl7MailboxMock).toHaveBeenCalledTimes(3);
  });

  it('processJob uses the sending facility when the roster is empty', async () => {
    getConfiguredYardiHl7PollTargetsMock.mockReturnValue([]);

    startYardiHl7PollWorker();
    await mockWorkerProcessor!({ id: 'job-3', data: {} });

    expect(forFacilityMock).toHaveBeenCalledTimes(1);
    expect(forFacilityMock).toHaveBeenCalledWith('EYELIVE');
  });
});
