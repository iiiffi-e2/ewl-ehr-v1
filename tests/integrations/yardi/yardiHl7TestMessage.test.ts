import { YardiHl7AdtAdapter } from '../../../src/integrations/ehr/yardiHl7AdtAdapter.js';
import {
  buildYardiHl7Adt,
  extractYardiHl7FromEventPayload,
  mintYardiHl7MessageControlId,
  remintYardiHl7MessageControlId,
} from '../../../src/integrations/yardi/yardiHl7TestMessage.js';

const TRIGGERS = ['A01', 'A02', 'A03', 'A05', 'A08', 'A21', 'A22', 'A60'] as const;

describe('yardiHl7TestMessage', () => {
  it('mints a message-control id at most 20 characters', () => {
    const id = mintYardiHl7MessageControlId();
    expect(id.startsWith('T')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(20);
    expect(id.length).toBeGreaterThanOrEqual(14);
  });

  it.each(TRIGGERS)('builds a parseable %s ADT', (trigger) => {
    const hl7 = buildYardiHl7Adt({
      trigger,
      residentId: '418612',
      roomNumber: '141',
      facilityId: 'EYELIVE',
      firstName: 'Denise',
      lastName: 'Morgan',
      dateOfBirth: '1940-01-02',
      gender: 'F',
    });
    const event = new YardiHl7AdtAdapter().parseInboundEvent(hl7);
    expect(event.eventType).toBe(`hl7.adt.${trigger.toLowerCase()}`);
    expect(event.notificationData.ResidentId).toBe(418612);
    expect(event.notificationData.RoomNumber).toBe('141');
    expect(event.notificationData.SendingFacility).toBe('EYELIVE');
    expect(String(event.eventMessageId).length).toBeLessThanOrEqual(20);
  });

  it('defaults name to Resident^Test when omitted', () => {
    const hl7 = buildYardiHl7Adt({
      trigger: 'A01',
      residentId: 99,
      roomNumber: '1',
      facilityId: 'EYELIVE',
    });
    expect(hl7).toContain('Resident^Test^');
  });

  it('replaces MSH-10 and keeps other fields', () => {
    const original = [
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A08|10529|P|2.5',
      'EVN|A08|20220908043209',
      'PID|1||418612||Morgan^Denise^||20220901000000|F',
      'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
    ].join('\r');
    const reminted = remintYardiHl7MessageControlId(original);
    expect(reminted.messageControlId).not.toBe('10529');
    expect(reminted.hl7).toContain(`|${reminted.messageControlId}|`);
    expect(reminted.hl7).not.toContain('|10529|');
    expect(reminted.hl7).toContain('ADT^A08');
    expect(reminted.hl7).toContain('418612');
  });

  it('extracts HL7 from notificationData.Message then raw.message', () => {
    const hl7 = 'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|dt||ADT^A01|1|P|2.5';
    expect(
      extractYardiHl7FromEventPayload({
        notificationData: { Message: hl7 },
        raw: { message: 'MSH|other' },
      }),
    ).toBe(hl7);
    expect(extractYardiHl7FromEventPayload({ raw: { message: hl7 } })).toBe(hl7);
    expect(extractYardiHl7FromEventPayload({ notificationData: { Message: 'nope' } })).toBeNull();
    expect(extractYardiHl7FromEventPayload({})).toBeNull();
  });
});
