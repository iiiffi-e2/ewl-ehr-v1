export type Hl7AckCode = 'AA' | 'AE' | 'AR';

export type BuildHl7AckArgs = {
  inboundMessage: string;
  ackCode: Hl7AckCode;
  textMessage?: string;
};

function firstSegment(message: string, prefix: string): string | undefined {
  return message
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix));
}

function field(segment: string | undefined, index: number): string {
  if (!segment) return '';
  const parts = segment.split('|');
  return parts[index] ?? '';
}

function nowHl7Timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/**
 * Build a minimal HL7 ACK from an inbound ADT message.
 * Swaps MSH sending/receiving application + facility.
 */
export function buildHl7Ack(args: BuildHl7AckArgs): string {
  const msh = firstSegment(args.inboundMessage, 'MSH|');
  const encoding = field(msh, 1) || '^~\\&';
  const sendingApp = field(msh, 2);
  const sendingFac = field(msh, 3);
  const receivingApp = field(msh, 4);
  const receivingFac = field(msh, 5);
  const trigger = (field(msh, 8).split('^')[1] || 'ACK').trim() || 'ACK';
  const controlId = field(msh, 9) || 'UNKNOWN';
  const processingId = field(msh, 10) || 'P';
  const version = field(msh, 11) || '2.5';

  const ackMsh = [
    'MSH',
    encoding,
    receivingApp,
    receivingFac,
    sendingApp,
    sendingFac,
    nowHl7Timestamp(),
    '',
    `ACK^${trigger}`,
    controlId,
    processingId,
    version,
  ].join('|');

  const msaParts = ['MSA', args.ackCode, controlId];
  if (args.textMessage) {
    msaParts.push(args.textMessage);
  }
  return `${ackMsh}\r${msaParts.join('|')}`;
}
