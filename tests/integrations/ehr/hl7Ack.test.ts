import { buildHl7Ack } from '../../../src/integrations/ehr/hl7Ack.js';

const SAMPLE_MSH =
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5';

describe('buildHl7Ack', () => {
  it('builds AA ACK swapping sending/receiving apps and facilities', () => {
    const ack = buildHl7Ack({ inboundMessage: SAMPLE_MSH + '\rEVN|A01', ackCode: 'AA' });
    const lines = ack.split(/\r/);
    expect(lines[0]).toMatch(/^MSH\|/);
    expect(lines[0]).toContain('|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|');
    expect(lines[0]).toContain('|ACK^A01|');
    expect(lines[0]).toContain('|10529|');
    expect(lines[1]).toBe('MSA|AA|10529');
  });

  it('builds AE ACK for validation failures', () => {
    const ack = buildHl7Ack({
      inboundMessage: SAMPLE_MSH,
      ackCode: 'AE',
      textMessage: 'Invalid payload',
    });
    expect(ack).toContain('MSA|AE|10529|Invalid payload');
  });

  it('builds AR ACK when control id is missing', () => {
    const ack = buildHl7Ack({
      inboundMessage: 'not-hl7',
      ackCode: 'AR',
      textMessage: 'Persist failed',
    });
    expect(ack).toContain('MSA|AR|UNKNOWN|Persist failed');
  });
});
