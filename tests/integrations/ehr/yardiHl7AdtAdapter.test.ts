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
