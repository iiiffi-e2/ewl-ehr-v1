export type BuildYardiHl7AdtInput = {
  trigger: string;
  residentId: string | number;
  roomNumber: string;
  facilityId: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  messageControlId?: string;
};

function randomHex4(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
}

export function mintYardiHl7MessageControlId(): string {
  return `T${Date.now()}${randomHex4()}`.slice(0, 20);
}

function formatHl7DateTime(value = new Date()): string {
  const yyyy = String(value.getUTCFullYear());
  const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(value.getUTCDate()).padStart(2, '0');
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const min = String(value.getUTCMinutes()).padStart(2, '0');
  const ss = String(value.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

function formatPidDate(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}${trimmed.slice(5, 7)}${trimmed.slice(8, 10)}000000`;
  }
  return trimmed;
}

export function buildYardiHl7Adt(input: BuildYardiHl7AdtInput): string {
  const trigger = input.trigger.trim().toUpperCase();
  const facilityId = input.facilityId.trim();
  const messageControlId = input.messageControlId ?? mintYardiHl7MessageControlId();
  const hl7DateTime = formatHl7DateTime();
  const lastName = (input.lastName ?? 'Resident').trim() || 'Resident';
  const firstName = (input.firstName ?? 'Test').trim() || 'Test';
  const msh = [
    'MSH',
    '^~\\&',
    'Yardi',
    facilityId,
    'EyeWatchLive',
    'EyeWatchLive',
    hl7DateTime,
    '',
    `ADT^${trigger}`,
    messageControlId,
    'P',
    '2.5',
  ].join('|');
  const evn = ['EVN', trigger, hl7DateTime].join('|');
  const pid = [
    'PID',
    '1',
    '',
    String(input.residentId).trim(),
    '',
    `${lastName}^${firstName}^`,
    '',
    formatPidDate(input.dateOfBirth),
    (input.gender ?? '').trim(),
  ].join('|');
  const pv1 = ['PV1', '1', 'I^Current', `AZone1^${input.roomNumber.trim()}^Single^${facilityId}`].join(
    '|',
  );
  return [msh, evn, pid, pv1].join('\r');
}

export function remintYardiHl7MessageControlId(hl7: string): {
  hl7: string;
  messageControlId: string;
} {
  const messageControlId = mintYardiHl7MessageControlId();
  const segments = hl7.split(/\r\n|\n|\r/);
  const next = segments.map((segment) => {
    if (!segment.startsWith('MSH|')) return segment;
    const parts = segment.split('|');
    if (parts.length > 9) {
      parts[9] = messageControlId;
    }
    return parts.join('|');
  });
  const joiner = hl7.includes('\r\n') ? '\r\n' : hl7.includes('\r') ? '\r' : '\n';
  return { hl7: next.join(joiner), messageControlId };
}

export function extractYardiHl7FromEventPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const notification =
    record.notificationData && typeof record.notificationData === 'object'
      ? (record.notificationData as Record<string, unknown>)
      : undefined;
  const fromNotification = notification?.Message;
  if (typeof fromNotification === 'string' && fromNotification.startsWith('MSH|')) {
    return fromNotification;
  }
  const raw = record.raw && typeof record.raw === 'object' ? (record.raw as Record<string, unknown>) : undefined;
  const fromRaw = raw?.message;
  if (typeof fromRaw === 'string' && fromRaw.startsWith('MSH|')) {
    return fromRaw;
  }
  return null;
}
