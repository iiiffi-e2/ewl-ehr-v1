import { parseCaspioSortableDate } from './caspioDateTime.js';

export type ServiceExportRow = {
  serviceId: string;
  cuid: string;
  patientNumber: string;
  serviceType: string;
  startDate: string;
  endDate: string;
  changeTimeStamp: string;
  roomNumber: string;
};

export type RepairActionType = 'set_end_date' | 'delete' | 'manual_review';

export type RepairAction = {
  serviceId: string;
  action: RepairActionType;
  proposedEndDate: string;
  reason: string;
  cuid: string;
  patientNumber: string;
  serviceType: string;
  startDate: string;
  changeTimeStamp: string;
  roomNumber: string;
};

const WALL_CLOCK =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s*([AaPp][Mm]))?$/;

/**
 * Propose EndDate and delete actions for an export of Service_Table_API.
 * This function does not read or write Caspio.
 *
 * Open rows are those with a blank EndDate. Rows that already have an EndDate are left alone.
 * A row with no ChangeTimeStamp is reported for manual review and is never closed or deleted.
 * Per room, duplicate Vacant rows written in the same ChangeTimeStamp second are removed,
 * keeping the room-level Vacant (no PatientNumber). Remaining open rows on a room keep the
 * latest StartDate; each earlier row is closed at the next row's StartDate. A resident who
 * is still open in more than one room keeps the latest room and the others are closed at that start.
 */
export function proposeServiceRowRepair(rows: ServiceExportRow[]): RepairAction[] {
  const actions = new Map<string, RepairAction>();
  const open = rows.filter((row) => row.endDate.trim().length === 0);

  for (const row of open) {
    if (!hasChangeTimeStamp(row)) {
      actions.set(row.serviceId, actionFor(row, 'manual_review', '', 'legacy_row_without_change_timestamp'));
    }
    if (roomKey(row).length === 0 && !actions.has(row.serviceId)) {
      actions.set(row.serviceId, actionFor(row, 'manual_review', '', 'missing_room_key'));
    }
  }

  const deletable = open.filter((row) => !actions.has(row.serviceId));
  for (const group of groupBy(deletable, roomKey).values()) {
    const vacants = group.filter((row) => isVacant(row));
    for (const sameSecond of groupBy(vacants, (row) => changeSecondKey(row.changeTimeStamp)).values()) {
      if (sameSecond.length < 2) continue;
      const roomLevel = sameSecond.filter((row) => row.patientNumber.trim().length === 0);
      const residentLinked = sameSecond.filter((row) => row.patientNumber.trim().length > 0);
      if (roomLevel.length > 0 && residentLinked.length > 0) {
        for (const row of residentLinked) {
          actions.set(row.serviceId, actionFor(row, 'delete', '', 'duplicate_vacant_same_second'));
        }
      }
      if (roomLevel.length > 1) {
        const keep = [...roomLevel].sort((a, b) => a.serviceId.localeCompare(b.serviceId))[0];
        for (const row of roomLevel) {
          if (row.serviceId === keep?.serviceId) continue;
          actions.set(row.serviceId, actionFor(row, 'delete', '', 'duplicate_vacant_same_second'));
        }
      }
    }
  }

  const afterDeletes = open.filter((row) => actions.get(row.serviceId)?.action !== 'delete');
  for (const group of groupBy(afterDeletes, roomKey).values()) {
    if (roomKey(group[0] ?? { cuid: '', roomNumber: '' } as ServiceExportRow).length === 0) continue;
    const ordered = [...group].sort(compareStart);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const row = ordered[index];
      const next = ordered[index + 1];
      if (!row || !next || actions.has(row.serviceId)) continue;
      const rowStart = parseCaspioSortableDate(row.startDate);
      const nextStart = parseCaspioSortableDate(next.startDate);
      if (!Number.isFinite(rowStart) || !Number.isFinite(nextStart) || nextStart <= rowStart) {
        actions.set(row.serviceId, actionFor(row, 'manual_review', '', 'unorderable_start_date'));
        continue;
      }
      actions.set(
        row.serviceId,
        actionFor(row, 'set_end_date', next.startDate.trim(), 'superseded_by_later_open_row'),
      );
    }
  }

  const stillOpen = open.filter((row) => {
    const existing = actions.get(row.serviceId);
    return existing?.action !== 'delete' && existing?.action !== 'set_end_date';
  });
  for (const group of groupBy(
    stillOpen.filter((row) => row.patientNumber.trim().length > 0),
    (row) => row.patientNumber.trim(),
  ).values()) {
    const rooms = new Set(group.map(roomKey).filter((key) => key.length > 0));
    if (rooms.size < 2) continue;
    const ordered = [...group].sort(compareStart);
    const keeper = ordered[ordered.length - 1];
    if (!keeper) continue;
    const keeperStart = parseCaspioSortableDate(keeper.startDate);
    for (const row of ordered) {
      if (row.serviceId === keeper.serviceId || actions.has(row.serviceId)) continue;
      const rowStart = parseCaspioSortableDate(row.startDate);
      if (!Number.isFinite(rowStart) || !Number.isFinite(keeperStart) || keeperStart <= rowStart) {
        actions.set(row.serviceId, actionFor(row, 'manual_review', '', 'unorderable_start_date'));
        continue;
      }
      actions.set(
        row.serviceId,
        actionFor(row, 'set_end_date', keeper.startDate.trim(), 'resident_open_in_multiple_rooms'),
      );
    }
  }

  return [...actions.values()].sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}

export function repairActionsToCsv(actions: RepairAction[]): string {
  const header = [
    'Service_ID',
    'action',
    'proposedEndDate',
    'reason',
    'CUID',
    'PatientNumber',
    'ServiceType',
    'StartDate',
    'ChangeTimeStamp',
    'RoomNumber',
  ];
  const lines = [header.join(',')];
  for (const action of actions) {
    lines.push(
      [
        action.serviceId,
        action.action,
        action.proposedEndDate,
        action.reason,
        action.cuid,
        action.patientNumber,
        action.serviceType,
        action.startDate,
        action.changeTimeStamp,
        action.roomNumber,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function parseServiceExportCsv(text: string): ServiceExportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const index = (names: string[]) => header.findIndex((cell) => names.includes(cell));
  const serviceId = index(['service_id', 'serviceid']);
  if (serviceId < 0) {
    throw new Error('Export CSV must include a Service_ID column');
  }
  const cuid = index(['cuid']);
  const patientNumber = index(['patientnumber', 'patient_number']);
  const serviceType = index(['servicetype', 'service_type']);
  const startDate = index(['startdate', 'start_date']);
  const endDate = index(['enddate', 'end_date']);
  const changeTimeStamp = index(['changetimestamp', 'change_timestamp']);
  const roomNumber = index(['roomnumber', 'room_number']);
  return rows.slice(1).flatMap((cells) => {
    const id = (cells[serviceId] ?? '').trim();
    if (id.length === 0) return [];
    return [
      {
        serviceId: id,
        cuid: cell(cells, cuid),
        patientNumber: cell(cells, patientNumber),
        serviceType: cell(cells, serviceType),
        startDate: cell(cells, startDate),
        endDate: cell(cells, endDate),
        changeTimeStamp: cell(cells, changeTimeStamp),
        roomNumber: cell(cells, roomNumber),
      },
    ];
  });
}

function actionFor(
  row: ServiceExportRow,
  action: RepairActionType,
  proposedEndDate: string,
  reason: string,
): RepairAction {
  return {
    serviceId: row.serviceId,
    action,
    proposedEndDate,
    reason,
    cuid: row.cuid,
    patientNumber: row.patientNumber,
    serviceType: row.serviceType,
    startDate: row.startDate,
    changeTimeStamp: row.changeTimeStamp,
    roomNumber: row.roomNumber,
  };
}

function hasChangeTimeStamp(row: ServiceExportRow): boolean {
  return row.changeTimeStamp.trim().length > 0;
}

function isVacant(row: ServiceExportRow): boolean {
  return row.serviceType.trim().toLowerCase() === 'vacant';
}

function roomKey(row: Pick<ServiceExportRow, 'cuid' | 'roomNumber'>): string {
  const cuid = row.cuid.trim();
  if (cuid.length > 0) return `cuid:${cuid}`;
  const room = row.roomNumber.replace(/\s+/g, '').toLowerCase();
  return room.length > 0 ? `room:${room}` : '';
}

function changeSecondKey(value: string): string {
  const trimmed = value.trim();
  const wall = trimmed.match(WALL_CLOCK);
  if (!wall) return trimmed;
  const [, month, day, year, hourText, minute, second, ampm] = wall;
  let hour = Number(hourText);
  if (ampm) {
    const marker = ampm.toLowerCase();
    if (marker === 'pm' && hour < 12) hour += 12;
    if (marker === 'am' && hour === 12) hour = 0;
  }
  const pad = (part: string | number) => String(part).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:${second}`;
}

function compareStart(a: ServiceExportRow, b: ServiceExportRow): number {
  const delta = parseCaspioSortableDate(a.startDate) - parseCaspioSortableDate(b.startDate);
  if (delta !== 0) return delta;
  return a.serviceId.localeCompare(b.serviceId);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function cell(cells: string[], index: number): string {
  if (index < 0) return '';
  return (cells[index] ?? '').trim();
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}
