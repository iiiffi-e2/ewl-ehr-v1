const getMessage = jest.fn();
const processAck = jest.fn();
const recordIncomingEvent = jest.fn();
const markEventIgnored = jest.fn();
const markEventQueued = jest.fn();
const enqueueJob = jest.fn();
const resolveFacility = jest.fn();
const processQueueAdd = jest.fn();

jest.mock('../../../src/domains/events.js', () => ({
  recordIncomingEvent,
  markEventIgnored,
  markEventQueued,
}));

jest.mock('../../../src/workers/queue.js', () => ({
  processAlisEventQueue: { add: processQueueAdd },
}));

import { drainYardiHl7Mailbox } from '../../../src/integrations/yardi/yardiHl7PollCapture.js';

const SAMPLE_ADT = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

const SAMPLE_ADT_A11 = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A11|10530|P|2.5',
  'EVN|A11|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('drainYardiHl7Mailbox', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('enqueues supported ADT for a rostered facility', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9, companyKey: 'yourlife' },
      isDuplicate: false,
    });
    resolveFacility.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });
    enqueueJob.mockResolvedValueOnce(undefined);
    markEventQueued.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
      resolveFacility,
      enqueueJob,
    });

    expect(summary).toEqual({ captured: 1, duplicates: 0, errors: 0, empty: true });
    expect(markEventIgnored).not.toHaveBeenCalled();
    expect(recordIncomingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ companyKey: 'yourlife', communityId: 113 }),
    );
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        eventType: 'hl7.adt.a01',
        companyKey: 'yourlife',
        companyId: 9,
        communityId: 113,
        eventMessageId: '10529',
        notificationData: expect.objectContaining({
          TriggerEvent: 'A01',
          ResidentId: 418612,
          SendingFacility: 'EYELIVE',
          Pv1Facility: 'EYELIVE',
          Message: SAMPLE_ADT,
          RoomNumber: '141',
        }),
      }),
    );
    expect(markEventQueued).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7', eventMessageId: '10529' }),
    );
    expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT);
    expect(getMessage).toHaveBeenCalledTimes(2);
  });

  it('ignores unknown facility and still ProcessACKs', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: false,
    });
    resolveFacility.mockReturnValue(null);
    markEventIgnored.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);

    await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
      resolveFacility,
      enqueueJob,
    });

    expect(recordIncomingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ companyKey: 'yardi', communityId: null }),
    );
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(markEventIgnored).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7' }),
      'unknown_facility',
    );
    expect(processAck).toHaveBeenCalled();
  });

  it('ignores unsupported trigger and still ProcessACKs', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT_A11 })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: false,
    });
    resolveFacility.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });
    markEventIgnored.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);

    await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
      resolveFacility,
      enqueueJob,
    });

    expect(enqueueJob).not.toHaveBeenCalled();
    expect(markEventIgnored).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'hl7.adt.a11' }),
      'unsupported_trigger',
    );
    expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT_A11);
  });

  it('re-enqueues a duplicate whose event log is still received', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1, status: 'received' },
      company: { id: 9 },
      isDuplicate: true,
    });
    enqueueJob.mockResolvedValueOnce(undefined);
    markEventQueued.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);
    resolveFacility.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
      resolveFacility,
      enqueueJob,
    });

    expect(summary.duplicates).toBe(1);
    expect(markEventIgnored).not.toHaveBeenCalled();
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        eventType: 'hl7.adt.a01',
        eventMessageId: '10529',
        companyId: 9,
        communityId: 113,
      }),
    );
    expect(markEventQueued).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7', eventMessageId: '10529' }),
    );
    expect(processAck).toHaveBeenCalled();
  });

  it.each(['failed', 'queued', 'processed'])(
    'ProcessACKs a duplicate with %s status without re-enqueueing',
    async (status) => {
      getMessage
        .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
        .mockResolvedValueOnce({ kind: 'empty' });
      recordIncomingEvent.mockResolvedValueOnce({
        eventLog: { id: 1, status },
        company: { id: 9 },
        isDuplicate: true,
      });
      processAck.mockResolvedValueOnce(undefined);
      resolveFacility.mockReturnValue({
        companyKey: 'yourlife',
        communityId: 113,
        facilityId: 'EYELIVE',
      });

      const summary = await drainYardiHl7Mailbox({
        client: { getMessage, processAck } as any,
        maxMessages: 50,
        resolveFacility,
        enqueueJob,
      });

      expect(summary.duplicates).toBe(1);
      expect(markEventIgnored).not.toHaveBeenCalled();
      expect(enqueueJob).not.toHaveBeenCalled();
      expect(markEventQueued).not.toHaveBeenCalled();
      expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT);
    },
  );

  it('does not ProcessACK when enqueue fails', async () => {
    getMessage.mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9, companyKey: 'yourlife' },
      isDuplicate: false,
    });
    resolveFacility.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });
    enqueueJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      drainYardiHl7Mailbox({
        client: { getMessage, processAck } as any,
        maxMessages: 50,
        resolveFacility,
        enqueueJob,
      }),
    ).rejects.toThrow('redis down');

    expect(processAck).not.toHaveBeenCalled();
  });

  it('does not ProcessACK when persistence fails', async () => {
    getMessage.mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT });
    recordIncomingEvent.mockRejectedValueOnce(new Error('database down'));
    resolveFacility.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });

    await expect(
      drainYardiHl7Mailbox({
        client: { getMessage, processAck } as any,
        maxMessages: 50,
        resolveFacility,
        enqueueJob,
      }),
    ).rejects.toThrow('database down');

    expect(processAck).not.toHaveBeenCalled();
  });

  it('tolerates a transient error then captures the next message', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'error', detail: 'network_ECONNRESET' })
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: false,
    });
    markEventIgnored.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);
    resolveFacility.mockReturnValue(null);

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
      resolveFacility,
      enqueueJob,
    });

    expect(summary).toEqual({ captured: 1, duplicates: 0, errors: 1, empty: true });
    expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT);
    expect(getMessage).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on application ACK errors without in-tick retry', async () => {
    getMessage.mockResolvedValue({ kind: 'error', detail: 'CE: Invalid password' });
    await expect(
      drainYardiHl7Mailbox({
        client: { getMessage, processAck } as any,
        maxMessages: 50,
        maxConsecutiveErrors: 3,
      }),
    ).rejects.toThrow(/CE: Invalid password/);
    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(processAck).not.toHaveBeenCalled();
  });

  it('throws after maxConsecutiveErrors consecutive network errors', async () => {
    getMessage.mockResolvedValue({ kind: 'error', detail: 'network_ECONNRESET' });
    await expect(
      drainYardiHl7Mailbox({
        client: { getMessage, processAck } as any,
        maxMessages: 50,
        maxConsecutiveErrors: 3,
      }),
    ).rejects.toThrow(/network_ECONNRESET/);
    expect(getMessage).toHaveBeenCalledTimes(3);
    expect(processAck).not.toHaveBeenCalled();
  });
});
