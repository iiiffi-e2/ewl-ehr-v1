import {
  buildGetMessageRequestXml,
  buildProcessAckXml,
  classifyGetMessageResponse,
  escapeXml,
  extractHl7FromBrokerResponseXml,
  formatBrokerResponseBodyForLog,
  unescapeXml,
  type YardiHl7BrokerIdentity,
} from '../../../src/integrations/yardi/yardiHl7BrokerXml.js';

const identity: YardiHl7BrokerIdentity = {
  yardiApplicationId: 'Yardi',
  yardiFacilityId: 'EYELIVE',
  pharmacySoftwareId: 'EyeWatchLive',
  pharmacyId: 'EyeWatchLive',
  password: 'test-pass',
};

describe('yardiHl7BrokerXml', () => {
  it('escapes and unescapes XML special characters', () => {
    const raw = 'a&b<c>d"e';
    const escaped = escapeXml(raw);
    expect(escaped).toBe('a&amp;b&lt;c&gt;d&quot;e');
    expect(unescapeXml(escaped)).toBe(raw);
  });

  it('builds GetMessage XML with QBP^Q11 and MSH.8.1 password', () => {
    const xml = buildGetMessageRequestXml({
      identity,
      messageControlId: '20220531010620',
      dateTime: '20220531010620',
    });
    expect(xml).toContain('<HL7MessageBroker>');
    expect(xml).toContain('<request>');
    expect(xml).toContain('QBP^Q11');
    expect(xml).toContain('|test-pass|');
    expect(xml).toContain('QPD|Check Mailbox|Q-CM1||');
    expect(xml).toContain(escapeXml('^~\\&'));
    // MSH header identity in Yardi-confirmed order: Yardi|EYELIVE|EyeWatchLive|EyeWatchLive
    expect(unescapeXml(xml)).toContain('|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|');
    // MSH must end with a trailing field separator after version 2.4, then a
    // carriage-return segment delimiter before QPD: |P|2.4|\rQPD
    expect(unescapeXml(xml)).toContain('|P|2.4|\rQPD|Check Mailbox|Q-CM1||\r');
  });

  it('extracts HL7 from broker response XML', () => {
    const hl7 = 'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|dt|pwd|ADT^A01|1|P|2.5\r';
    const xml = `<HL7MessageBroker><response>${escapeXml(hl7)}</response></HL7MessageBroker>`;
    expect(extractHl7FromBrokerResponseXml(xml)).toBe(hl7);
  });

  it('classifies empty mailbox response', () => {
    const hl7 =
      'MSH|^~\\&|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|20220906110541|x|ACK^Q11|20220906110541|P|2.4\rMSA|CR|20220906110541\r';
    const xml = `<HL7MessageBroker><response>${escapeXml(hl7)}</response></HL7MessageBroker>`;
    const result = classifyGetMessageResponse(xml);
    expect(result.kind).toBe('empty');
  });

  it('classifies ADT payload from response', () => {
    const adt = [
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5',
      'EVN|A01|20220908043209',
      'PID|1||418612||Morgan^Denise^||20220901000000|F',
      'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
    ].join('\r');
    const xml = `<HL7MessageBroker><DestinationIP/><DestinationPort/><response>${escapeXml(
      adt
    )}</response></HL7MessageBroker>`;
    const result = classifyGetMessageResponse(xml);
    expect(result.kind).toBe('adt');
    if (result.kind === 'adt') {
      expect(result.hl7).toContain('ADT^A01');
      expect(result.hl7).toContain('10529');
    }
  });

  it('classifies error ACK', () => {
    const hl7 =
      'MSH|^~\\&|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|20220906110525|x|ACK^Q11|id|P|2.4\rMSA|CE|id\r';
    const xml = `<HL7MessageBroker><response>${escapeXml(hl7)}</response></HL7MessageBroker>`;
    expect(classifyGetMessageResponse(xml).kind).toBe('error');
  });

  it('formats broker response body for safe logging', () => {
    const body =
      '<HL7MessageBroker><Password>super-secret</Password><response></response></HL7MessageBroker>';
    const formatted = formatBrokerResponseBodyForLog(body, ['super-secret']);
    expect(formatted.bodyLength).toBe(body.length);
    expect(formatted.bodyPreview).toContain('[REDACTED]');
    expect(formatted.bodyPreview).not.toContain('super-secret');
    expect(formatted.hasResponseElement).toBe(true);
    expect(formatted.responseElementEmpty).toBe(true);
  });

  it('builds ProcessACK XML for successful ADT delivery', () => {
    const adt =
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220529100022||ADT^A08|792|P|2.5\rEVN|A08|20210928141035\r';
    const xml = buildProcessAckXml({
      adtMessage: adt,
      identity,
      password: 'mailbox-pwd',
    });
    expect(xml).toContain('<MessageType>ADT</MessageType>');
    expect(xml).toContain('<Operation>ACK</Operation>');
    expect(xml).toContain('<ADTQueue><ID>792</ID></ADTQueue>');
    expect(xml).toContain('<ExternalSoftwareID>EyeWatchLive</ExternalSoftwareID>');
    expect(xml).toContain('<ExternalPharmacyID>EyeWatchLive</ExternalPharmacyID>');
    expect(xml).toContain('<ExternalAppID>Yardi</ExternalAppID>');
    expect(xml).toContain('<ExternalFacilityID>EYELIVE</ExternalFacilityID>');
    expect(xml).toContain('<Password>mailbox-pwd</Password>');
    expect(xml).toContain('<AckCode>0</AckCode>');
    expect(xml).toContain('<AckDescription>Success</AckDescription>');
  });
});
