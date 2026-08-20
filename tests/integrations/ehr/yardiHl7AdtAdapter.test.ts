import { YardiHl7AdtAdapter } from '../../../src/integrations/ehr/yardiHl7AdtAdapter.js';

const SAMPLE_ADT_A01 = [
  'MSH|^~\\&|YARDI|FAC1|RCVAPP|RCVFAC|20260403120000||ADT^A01|123|P|2.5',
  'EVN|A01|20260403120000',
  'PID|1||70508||Doe^Jane||19440210|F',
  'PV1|1|I^Current|W2^101^A^FAC1',
].join('\r');

describe('YardiHl7AdtAdapter', () => {
  it('parses HL7 ADT webhook into canonical event', () => {
    const adapter = new YardiHl7AdtAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'yardi-company',
      CommunityId: 113,
      EventMessageId: 'hl7-evt-1',
      EventMessageDate: '2026-04-03T12:00:00Z',
      Message: SAMPLE_ADT_A01,
    });

    expect(event).toMatchObject({
      source: 'yardi-hl7',
      eventType: 'hl7.adt.a01',
      lifecycleKind: 'move_in',
      notificationData: expect.objectContaining({
        TriggerEvent: 'A01',
        ResidentId: 70508,
      }),
    });
  });

  it('builds canonical resident bundle from HL7 message', async () => {
    const adapter = new YardiHl7AdtAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'yardi-company',
      CommunityId: 113,
      EventMessageId: 'hl7-evt-2',
      EventMessageDate: '2026-04-03T12:00:00Z',
      Message: SAMPLE_ADT_A01,
    });

    const residentId = adapter.resolveResidentId({ event });
    const bundle = await adapter.fetchResidentBundle({
      companyId: 10,
      companyKey: 'yardi-company',
      event,
      residentId,
    });

    expect(bundle.residentId).toBe(70508);
    expect(bundle.demographics).toMatchObject({
      externalResidentId: '70508',
      firstName: 'Jane',
      lastName: 'Doe',
      roomNumber: '101',
      bed: 'A',
      dateOfBirth: '1944-02-10T00:00:00.000Z',
    });
  });
});

const SAMPLE_YARDI_RAW = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('YardiHl7AdtAdapter raw HL7', () => {
  it('parses a raw HL7 string into a canonical event', () => {
    const adapter = new YardiHl7AdtAdapter();
    const event = adapter.parseInboundEvent(SAMPLE_YARDI_RAW);

    expect(event).toMatchObject({
      source: 'yardi-hl7',
      companyKey: 'yardi',
      communityId: null,
      eventType: 'hl7.adt.a01',
      eventMessageId: '10529',
      lifecycleKind: 'move_in',
      notificationData: expect.objectContaining({
        TriggerEvent: 'A01',
        ResidentId: 418612,
        SendingApplication: 'Yardi',
        SendingFacility: 'EYELIVE',
        Pv1Facility: 'EYELIVE',
        ReceivingApplication: 'EyeWatchLive',
        ReceivingFacility: 'EyeWatchLive',
        RoomNumber: '141',
      }),
    });
    expect(event.eventMessageDate).toMatch(/2022-09-08/);
    expect((event.raw as { message?: string }).message).toContain('MSH|');
    expect((event.raw as { parsed?: { messageControlId?: string; triggerEvent?: string } }).parsed).toMatchObject({
      messageControlId: '10529',
      triggerEvent: 'A01',
    });
  });

  it('still parses the existing JSON envelope', () => {
    const adapter = new YardiHl7AdtAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'yardi-company',
      CommunityId: 113,
      EventMessageId: 'hl7-evt-1',
      EventMessageDate: '2026-04-03T12:00:00Z',
      Message: SAMPLE_ADT_A01,
    });
    expect(event.companyKey).toBe('yardi-company');
    expect(event.communityId).toBe(113);
    expect(event.eventMessageId).toBe('hl7-evt-1');
  });

  it('rejects non-HL7 strings', () => {
    const adapter = new YardiHl7AdtAdapter();
    expect(() => adapter.parseInboundEvent('hello')).toThrow();
  });
});
