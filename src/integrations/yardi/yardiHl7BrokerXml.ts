export type YardiHl7BrokerIdentity = {
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
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
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function buildGetMessageRequestXml(args: {
  identity: YardiHl7BrokerIdentity;
  messageControlId: string;
  dateTime: string;
}): string {
  const { identity } = args;
  const msh = [
    'MSH',
    '^~\\&',
    identity.sendingApplication,
    identity.sendingFacility,
    identity.receivingApplication,
    identity.receivingFacility,
    args.dateTime,
    identity.password,
    'QBP^Q11',
    args.messageControlId,
    'P',
    '2.4',
  ].join('|');
  const qpd = 'QPD|Check Mailbox|Q-CM1||';
  const hl7 = `${msh}\r${qpd}\r`;
  return `<HL7MessageBroker><request>${escapeXml(hl7)}</request></HL7MessageBroker>`;
}

const BROKER_RESPONSE_LOG_PREVIEW_CHARS = 200;

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

function msaAckCode(hl7: string): string | undefined {
  const msa = hl7.split(/\r?\n|\r/).find((line) => line.startsWith('MSA|'));
  if (!msa) return undefined;
  return msa.split('|')[1];
}

function mshMessageType(hl7: string): string | undefined {
  const msh = hl7.split(/\r?\n|\r/).find((line) => line.startsWith('MSH|'));
  if (!msh) return undefined;
  return msh.split('|')[8]; // MSH.9
}

export function classifyGetMessageResponse(xml: string): GetMessageClassification {
  const hl7 = extractHl7FromBrokerResponseXml(xml);
  if (!hl7) return { kind: 'error', detail: 'missing_response' };

  const type = mshMessageType(hl7) ?? '';
  const ack = msaAckCode(hl7);

  if (type.startsWith('ADT^') || type.startsWith('ADT|')) {
    return { kind: 'adt', hl7 };
  }
  // Some brokers put ADT without relying on MSA
  if (hl7.includes('\rPID|') || hl7.includes('\nPID|')) {
    return { kind: 'adt', hl7 };
  }
  if (ack === 'CR') return { kind: 'empty' };
  if (ack === 'CE' || ack === 'AR' || ack === 'AE') {
    return { kind: 'error', detail: ack };
  }
  if (type.startsWith('ACK')) {
    return ack === 'CR' ? { kind: 'empty' } : { kind: 'error', detail: ack ?? 'ack' };
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
    `<ExternalSoftwareID>${escapeXml(args.identity.sendingApplication)}</ExternalSoftwareID>`,
    `<ExternalPharmacyID>${escapeXml(args.identity.sendingFacility)}</ExternalPharmacyID>`,
    '</Pharmacy>',
    '<PharmacyPropertyComm>',
    `<ExternalAppID>${escapeXml(args.identity.receivingApplication)}</ExternalAppID>`,
    `<ExternalFacilityID>${escapeXml(args.identity.receivingFacility)}</ExternalFacilityID>`,
    `<Password>${escapeXml(args.password)}</Password>`,
    '</PharmacyPropertyComm>',
    '<Response>',
    '<AckCode>0</AckCode>',
    '<AckDescription>Success</AckDescription>',
    '</Response>',
    '</Message>',
  ].join('');
}
