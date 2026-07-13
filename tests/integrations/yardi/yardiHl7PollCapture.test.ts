const getMessage = jest.fn();
const processAck = jest.fn();
const recordIncomingEvent = jest.fn();
const markEventIgnored = jest.fn();

jest.mock('../../../src/domains/events.js', () => ({
  recordIncomingEvent,
  markEventIgnored,
}));

import { drainYardiHl7Mailbox } from '../../../src/integrations/yardi/yardiHl7PollCapture.js';

const SAMPLE_ADT = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('drainYardiHl7Mailbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures ADT, marks capture_only, ProcessACKs, then stops on empty', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: false,
    });
    markEventIgnored.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
    });

    expect(summary).toEqual({ captured: 1, duplicates: 0, empty: true });
    expect(markEventIgnored).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7', eventMessageId: '10529' }),
      'capture_only',
    );
    expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT);
    expect(getMessage).toHaveBeenCalledTimes(2);
  });

  it('ProcessACKs duplicates without markEventIgnored', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: true,
    });
    processAck.mockResolvedValueOnce(undefined);

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
    });

    expect(summary.duplicates).toBe(1);
    expect(markEventIgnored).not.toHaveBeenCalled();
    expect(processAck).toHaveBeenCalled();
  });

  it('throws on broker error without ProcessACK', async () => {
    getMessage.mockResolvedValueOnce({ kind: 'error', detail: 'CE' });
    await expect(
      drainYardiHl7Mailbox({ client: { getMessage, processAck } as any, maxMessages: 50 }),
    ).rejects.toThrow(/broker/i);
    expect(processAck).not.toHaveBeenCalled();
  });
});
