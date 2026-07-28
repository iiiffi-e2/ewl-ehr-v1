/**
 * Fixed channel identity per Yardi's Restful Message Broker spec. The same
 * four identifiers are used in BOTH the GetMessage MSH header and the
 * ProcessACK body, so we name them by role rather than HL7 direction to
 * avoid the sending/receiving confusion that previously reversed the header.
 *
 * GetMessage MSH layout (Yardi-confirmed):
 *   MSH.3.1 Sending Application ID .......... yardiApplicationId (Yardi)
 *   MSH.4.1 Sending Facility ID ............. yardiFacilityId (EYELIVE)
 *   MSH.5.1 Receiving Software ID ........... pharmacySoftwareId (EyeWatchLive)
 *   MSH.6.1 Receiving Facility / Pharmacy ID  pharmacyId (EyeWatchLive)
 */
export type YardiHl7BrokerIdentity = {
  yardiApplicationId: string;
  yardiFacilityId: string;
  pharmacySoftwareId: string;
  pharmacyId: string;
  password: string;
};

export type GetMessageClassification =
  | { kind: 'adt'; hl7: string }
  | { kind: 'empty' }
  | { kind: 'error'; detail?: string };

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function unescapeXml(value: string): string {
  // Named entities first so double-escaped CR refs like &amp;#13; become &#13;,
  // then numeric character references (Yardi serializes HL7 segment breaks as &#13;).
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number.parseInt(dec, 10)));
}

export function buildGetMessageRequestXml(args: {
  identity: YardiHl7BrokerIdentity;
  messageControlId: string;
  dateTime: string;
}): string {
  const { identity } = args;
  // Trailing empty field required after MSH.12 (version) so the MSH segment
  // ends with a field separator, per Yardi's broker requirement: |P|2.4|
  const msh = `${[
    'MSH',
    '^~\\&',
    identity.yardiApplicationId, // MSH.3.1
    identity.yardiFacilityId, // MSH.4.1
    identity.pharmacySoftwareId, // MSH.5.1
    identity.pharmacyId, // MSH.6.1
    args.dateTime,
    identity.password,
    'QBP^Q11',
    args.messageControlId,
    'P',
    '2.4',
  ].join('|')}|`;
  const qpd = 'QPD|Check Mailbox|Q-CM1||';
  // HL7 segment delimiter is a carriage return (MSH<CR>QPD<CR>). Yardi's broker
  // requires the CR serialized as the XML numeric character reference &#13; (not
  // a raw CR byte) so its XML parser reconstructs the HL7 carriage return.
  // Escape XML entities first, then substitute CRs with &#13; so the literal
  // ampersand in the reference is not itself escaped to &amp;.
  const hl7 = `${msh}\r${qpd}\r`;
  const serialized = escapeXml(hl7).replace(/\r/g, '&#13;');
  return `<HL7MessageBroker><request>${serialized}</request></HL7MessageBroker>`;
}

const BROKER_RESPONSE_LOG_PREVIEW_CHARS = 200;

export function sanitizeXmlForLog(
  body: string,
  secrets: string[] = [],
  options: { revealControlChars?: boolean } = {},
): string {
  let sanitized = body;
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  sanitized = sanitized.replace(
    /<Password>[\s\S]*?<\/Password>/gi,
    '<Password>[REDACTED]</Password>',
  );
  // For request bodies we want to SEE the HL7 delimiters (\r) rather than
  // collapse them, so escape control chars into visible \r / \n / \t.
  const normalized = options.revealControlChars
    ? sanitized.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    : sanitized.replace(/\s+/g, ' ').trim();
  return normalized.length > BROKER_RESPONSE_LOG_PREVIEW_CHARS
    ? `${normalized.slice(0, BROKER_RESPONSE_LOG_PREVIEW_CHARS)}…`
    : normalized || '(empty)';
}

export function formatBrokerResponseBodyForLog(
  body: string,
  secrets: string[] = [],
): {
  bodyLength: number;
  bodyPreview: string;
  hasResponseElement: boolean;
  responseElementEmpty: boolean;
} {
  let sanitized = body;
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  sanitized = sanitized.replace(
    /<Password>[\s\S]*?<\/Password>/gi,
    '<Password>[REDACTED]</Password>',
  );

  const responseMatch = body.match(/<response\b[^>]*>([\s\S]*?)<\/response>/i);
  const responseInner = responseMatch?.[1]?.replace(/^[ \t]+|[ \t]+$/g, '') ?? '';

  const preview =
    sanitized.length > BROKER_RESPONSE_LOG_PREVIEW_CHARS
      ? `${sanitized.slice(0, BROKER_RESPONSE_LOG_PREVIEW_CHARS)}…`
      : sanitized;

  return {
    bodyLength: body.length,
    bodyPreview: preview.replace(/\s+/g, ' ').trim() || '(empty)',
    hasResponseElement: Boolean(responseMatch),
    responseElementEmpty: Boolean(responseMatch) && responseInner.length === 0,
  };
}

export function extractHl7FromBrokerResponseXml(xml: string): string | null {
  const match = xml.match(/<response>([\s\S]*?)<\/response>/i);
  if (!match?.[1]) return null;
  // Trim spaces/tabs only — keep HL7 segment terminators (\r)
  return unescapeXml(match[1].replace(/^[ \t]+|[ \t]+$/g, ''));
}

function splitHl7Segments(hl7: string): string[] {
  // After XML unescape, segment breaks may still appear as literal "\r" text
  // from some intermediaries; normalize those before splitting.
  const normalized = hl7.replace(/\\r/g, '\r');
  return normalized.split(/\r?\n|\r/);
}

function msaFields(hl7: string): { code?: string; text?: string } {
  const msa = splitHl7Segments(hl7).find((line) => line.startsWith('MSA|'));
  if (!msa) return {};
  const parts = msa.split('|');
  return {
    code: parts[1] || undefined,
    text: parts[3]?.trim() || undefined,
  };
}

function mshMessageType(hl7: string): string | undefined {
  const msh = splitHl7Segments(hl7).find((line) => line.startsWith('MSH|'));
  if (!msh) return undefined;
  return msh.split('|')[8]; // MSH.9
}

function ackErrorDetail(code: string | undefined, text: string | undefined): string {
  if (!code) return text ? `ack: ${text}` : 'ack';
  return text ? `${code}: ${text}` : code;
}

export function classifyGetMessageResponse(xml: string): GetMessageClassification {
  const hl7 = extractHl7FromBrokerResponseXml(xml);
  if (!hl7) return { kind: 'error', detail: 'missing_response' };

  const type = mshMessageType(hl7) ?? '';
  const { code: ack, text: ackText } = msaFields(hl7);

  if (type.startsWith('ADT^') || type.startsWith('ADT|')) {
    return { kind: 'adt', hl7 };
  }
  // Some brokers put ADT without relying on MSA
  if (hl7.includes('\rPID|') || hl7.includes('\nPID|')) {
    return { kind: 'adt', hl7 };
  }
  if (ack === 'CR') return { kind: 'empty' };
  if (ack === 'CE' || ack === 'AR' || ack === 'AE') {
    return { kind: 'error', detail: ackErrorDetail(ack, ackText) };
  }
  if (type.startsWith('ACK')) {
    return ack === 'CR'
      ? { kind: 'empty' }
      : { kind: 'error', detail: ackErrorDetail(ack, ackText) };
  }
  return { kind: 'error', detail: 'unrecognized' };
}

export function buildProcessAckXml(args: {
  adtMessage: string;
  identity: YardiHl7BrokerIdentity;
  password: string;
}): string {
  const msh = args.adtMessage.split(/\r?\n|\r/).find((l) => l.startsWith('MSH|')) ?? '';
  const parts = msh.split('|');
  const messageType = (parts[8] ?? 'ADT').split('^')[0] || 'ADT';
  const controlId = parts[9] || 'UNKNOWN';
  // Pharmacy on ACK XML = our software/pharmacy IDs (EyeWatchLive)
  // PharmacyPropertyComm = Yardi app/facility + password
  return [
    '<Message>',
    `<MessageType>${escapeXml(messageType)}</MessageType>`,
    '<Operation>ACK</Operation>',
    `<ADTQueue><ID>${escapeXml(controlId)}</ID></ADTQueue>`,
    '<DestinationChannel></DestinationChannel>',
    '<Pharmacy>',
    `<ExternalSoftwareID>${escapeXml(args.identity.pharmacySoftwareId)}</ExternalSoftwareID>`,
    `<ExternalPharmacyID>${escapeXml(args.identity.pharmacyId)}</ExternalPharmacyID>`,
    '</Pharmacy>',
    '<PharmacyPropertyComm>',
    `<ExternalAppID>${escapeXml(args.identity.yardiApplicationId)}</ExternalAppID>`,
    `<ExternalFacilityID>${escapeXml(args.identity.yardiFacilityId)}</ExternalFacilityID>`,
    `<Password>${escapeXml(args.password)}</Password>`,
    '</PharmacyPropertyComm>',
    '<Response>',
    '<AckCode>0</AckCode>',
    '<AckDescription>Success</AckDescription>',
    '</Response>',
    '</Message>',
  ].join('');
}
