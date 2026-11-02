/**
 * Caspio stores StartDate/EndDate as wall-clock text with no zone.
 * Staff read those columns directly, so service boundaries are written in the
 * community's local time. Date-only inputs stay date-only.
 *
 * Unmapped communities use America/New_York, the zone of the Caspio account
 * (ChangeTimeStamp) and of every YourLife community except Pensacola.
 */

const EASTERN = 'America/New_York';
const CENTRAL = 'America/Chicago';

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MDY_DATE_ONLY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ZONELESS_ISO = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;
const AMPM_WALL =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AaPp][Mm])$/;

export function communityTimeZone(communityName?: string): string {
  const name = (communityName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (name.includes('pensacola')) {
    return CENTRAL;
  }
  return EASTERN;
}

export function formatCaspioDateOnly(value: string): string | undefined {
  const trimmed = value.trim();
  const iso = trimmed.match(ISO_DATE_ONLY);
  if (iso) {
    return `${iso[2]}/${iso[3]}/${iso[1]}`;
  }
  const mdy = trimmed.match(MDY_DATE_ONLY);
  if (mdy) {
    return `${mdy[1].padStart(2, '0')}/${mdy[2].padStart(2, '0')}/${mdy[3]}`;
  }
  return undefined;
}

/**
 * Format a service boundary for Caspio.
 * Missing value → current time in `timeZone`.
 * `YYYY-MM-DD` or `M/D/YYYY` → `MM/DD/YYYY` with no clock time.
 * Instants (including zone-less ISO, treated as UTC) → local `MM/DD/YYYY HH:mm:ss`.
 */
export function formatCaspioDateTime(value: string | undefined, timeZone: string): string {
  if (!value || value.trim().length === 0) {
    return formatInstant(new Date(), timeZone);
  }
  const trimmed = value.trim();
  const dateOnly = formatCaspioDateOnly(trimmed);
  if (dateOnly && (ISO_DATE_ONLY.test(trimmed) || MDY_DATE_ONLY.test(trimmed))) {
    return dateOnly;
  }
  const wallClock = formatAmPmWallClock(trimmed);
  if (wallClock) {
    return wallClock;
  }
  const instant = parseInstant(trimmed);
  if (!instant) {
    return formatInstant(new Date(), timeZone);
  }
  return formatInstant(instant, timeZone);
}

/** Sort key for Caspio date text, including legacy `M/D/YYYY h:mm:ss AM/PM` values. */
export function parseCaspioSortableDate(value: unknown): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const trimmed = value.trim();
  const ampm = parseAmPmAsUtcNumbers(trimmed);
  if (ampm !== undefined) {
    return ampm;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const mdYDateTimeMatch = trimmed.match(
    /^(\d{1,2})[/:](\d{1,2})[/:](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/,
  );
  if (!mdYDateTimeMatch) {
    return Number.NEGATIVE_INFINITY;
  }
  const [, month, day, year, hour, minute, second] = mdYDateTimeMatch;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );
}

function parseInstant(value: string): Date | undefined {
  const zoneless = value.match(ZONELESS_ISO);
  const normalized = zoneless ? `${zoneless[1]}T${zoneless[2]}Z` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatAmPmWallClock(value: string): string | undefined {
  const match = value.match(AMPM_WALL);
  if (!match) return undefined;
  const [, month, day, year, hourText, minute, second, meridiem] = match;
  let hour = Number(hourText);
  const mer = meridiem.toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
}

function parseAmPmAsUtcNumbers(value: string): number | undefined {
  const match = value.match(AMPM_WALL);
  if (!match) return undefined;
  const [, month, day, year, hourText, minute, second, meridiem] = match;
  let hour = Number(hourText);
  const mer = meridiem.toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour,
    Number(minute),
    Number(second),
    0,
  );
}

function formatInstant(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  let hour = read('hour');
  if (hour === '24') hour = '00';
  return `${read('month')}/${read('day')}/${read('year')} ${hour}:${read('minute')}:${read('second')}`;
}
