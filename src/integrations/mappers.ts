import { parseISO } from 'date-fns';

import type {
  AlisLeave,
  AlisResidentBasicInfo,
  AlisResidentDetail,
  AlisRoom,
} from './alisClient.js';
import type { NormalizedResidentData } from '../domains/residents.js';

type Nullable<T> = T | null | undefined;

export type NormalizeResidentInput = {
  detail: AlisResidentDetail;
  basicInfo?: AlisResidentBasicInfo;
};

export type CaspioResidentPayload = {
  companyKey: string;
  communityId: number | null;
  alisResidentId: number;
  status: string;
  productType: string | null;
  classification: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  room: string | null;
  roomNumber: string | null;
  bed: string | null;
  updatedAtUtc: string | null;
  eventType: string;
  eventMessageId: string;
  eventTimestamp: string;
  leaveStartDate?: string | null;
  leaveEndDate?: string | null;
  leaveExpectedReturnDate?: string | null;
  leaveReason?: string | null;
};

export function normalizeResident({
  detail,
  basicInfo,
}: NormalizeResidentInput): NormalizedResidentData {
  const alisResidentId = getNumber(detail, ['ResidentId', 'residentId']);
  if (!alisResidentId) {
    throw new Error('Resident data missing ResidentId');
  }

  const statusRaw = getString(detail, ['Status', 'status']);

  const rooms = extractRooms(detail, basicInfo);
  const currentRoom = pickCurrentRoom(rooms);

  const firstName = getString(detail, ['FirstName', 'firstName']);
  const lastName = getString(detail, ['LastName', 'lastName']);
  const dobString = getString(detail, ['DateOfBirth', 'dateOfBirth']);
  const classification =
    getString(detail, ['Classification', 'classification']) ??
    getString(basicInfo, ['Classification', 'classification']);
  const productType =
    getString(detail, ['ProductType', 'productType']) ??
    getString(basicInfo, ['ProductType', 'productType']);

  const dateOfBirth = dobString ? safeParseDate(dobString) : null;

  const updatedAtString = getString(detail, ['UpdatedAtUtc', 'updatedAtUtc']);
  const updatedAtUtc = updatedAtString ? safeParseDate(updatedAtString) : null;

  const roomNumber =
    getString(currentRoom, ['RoomNumber', 'roomNumber']) ??
    getString(currentRoom, ['Room', 'room'])?.split(' ')?.[0] ??
    null;
  const bed =
    getString(currentRoom, ['Bed', 'bed']) ??
    getString(currentRoom, ['Room', 'room'])?.split(' ')?.[1] ??
    null;

  const room =
    getString(currentRoom, ['Room', 'room']) ??
    formatRoom(roomNumber, bed);

  // Extract isOnLeave and onLeaveStartDateUtc for On_Prem/Off_Prem logic
  const isOnLeave = getBoolean(detail, ['IsOnLeave', 'isOnLeave', 'OnLeave', 'onLeave']);
  
  // On_Prem: true UNLESS isOnLeave=true. If isOnLeave is null or false, On_Prem should be true.
  const onPrem: boolean = isOnLeave !== true;
  
  // Off_Prem: only true if isOnLeave=true
  const offPrem: boolean = isOnLeave === true;
  
  // On_Prem_Date: move-in date (prefer PhysicalMoveInDate, fallback to FinancialMoveInDate)
  const physicalMoveInDateString = getString(detail, [
    'PhysicalMoveInDate',
    'physicalMoveInDate',
    'PhysicalMoveIn',
    'physicalMoveIn',
  ]);
  const financialMoveInDateString = getString(detail, [
    'FinancialMoveInDate',
    'financialMoveInDate',
    'FinancialMoveIn',
    'financialMoveIn',
  ]);
  const moveInDateString = physicalMoveInDateString || financialMoveInDateString;
  const onPremDate = moveInDateString ? safeParseDate(moveInDateString) : null;
  
  // Off_Prem_Date: set to onLeaveStartDateUtc if isOnLeave=true
  const onLeaveStartDateString = getString(detail, [
    'OnLeaveStartDateUtc',
    'onLeaveStartDateUtc',
    'OnLeaveStartDate',
    'onLeaveStartDate',
    'LeaveStartDate',
    'leaveStartDate',
  ]);
  const offPremDate = isOnLeave === true && onLeaveStartDateString ? safeParseDate(onLeaveStartDateString) : null;

  return {
    alisResidentId,
    status: normalizeStatus(statusRaw),
    productType: productType ?? null,
    classification: classification ?? null,
    firstName: firstName ?? null,
    lastName: lastName ?? null,
    dateOfBirth,
    roomNumber,
    bed,
    room,
    updatedAtUtc,
    onPrem,
    onPremDate,
    offPrem,
    offPremDate,
  };
}

export function buildCaspioPayload(params: {
  resident: NormalizedResidentData;
  companyKey: string;
  communityId: number | null;
  eventType: string;
  eventMessageId: string;
  eventTimestamp: string;
  leave?: AlisLeave | null;
}): CaspioResidentPayload {
  const { resident, leave } = params;

  return {
    companyKey: params.companyKey,
    communityId: params.communityId,
    alisResidentId: resident.alisResidentId,
    status: resident.status,
    productType: resident.productType ?? null,
    classification: resident.classification ?? null,
    firstName: resident.firstName ?? null,
    lastName: resident.lastName ?? null,
    dateOfBirth: resident.dateOfBirth ? resident.dateOfBirth.toISOString() : null,
    room: resident.room ?? null,
    roomNumber: resident.roomNumber ?? null,
    bed: resident.bed ?? null,
    updatedAtUtc: resident.updatedAtUtc ? resident.updatedAtUtc.toISOString() : null,
    eventType: params.eventType,
    eventMessageId: params.eventMessageId,
    eventTimestamp: params.eventTimestamp,
    leaveStartDate: leave ? getString(leave, ['StartDate', 'startDate']) ?? null : null,
    leaveEndDate: leave ? getString(leave, ['EndDate', 'endDate']) ?? null : null,
    leaveExpectedReturnDate: leave
      ? getString(leave, ['ExpectedReturnDate', 'expectedReturnDate']) ?? null
      : null,
    leaveReason: leave ? getString(leave, ['Reason', 'reason']) ?? null : null,
  };
}

function extractRooms(
  detail: AlisResidentDetail,
  basicInfo?: AlisResidentBasicInfo,
): AlisRoom[] {
  const detailRooms = getRooms(detail);
  if (detailRooms.length) {
    return detailRooms;
  }
  const basicRooms = basicInfo ? getRooms(basicInfo) : [];
  return basicRooms;
}

function getRooms(entity: { Rooms?: AlisRoom[]; rooms?: AlisRoom[] } | undefined): AlisRoom[] {
  if (!entity) return [];
  if (Array.isArray(entity.Rooms)) return entity.Rooms;
  if (Array.isArray(entity.rooms)) return entity.rooms;
  return [];
}

function pickCurrentRoom(rooms: AlisRoom[]): AlisRoom | undefined {
  return rooms.find((room) => room.IsPrimary || room.isPrimary) ?? rooms[0];
}

function formatRoom(roomNumber: Nullable<string>, bed: Nullable<string>): string | null {
  if (!roomNumber) return null;
  if (!bed) return roomNumber;
  return `${roomNumber} ${bed}`;
}

function normalizeStatus(statusRaw?: string | null): string {
  if (!statusRaw) return 'unknown';
  return statusRaw.toLowerCase();
}

function safeParseDate(value: string): Date | null {
  if (!value) return null;
  try {
    const parsed = parseISO(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function getString<T extends Record<string, unknown> | undefined>(
  obj: T,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function getNumber<T extends Record<string, unknown> | undefined>(
  obj: T,
  keys: string[],
): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function getBoolean<T extends Record<string, unknown> | undefined>(
  obj: T,
  keys: string[],
): boolean | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no') return false;
    }
  }
  return undefined;
}