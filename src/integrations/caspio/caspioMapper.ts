import { format, parseISO } from 'date-fns';
import { createHash } from 'crypto';

import type { AlisEvent } from '../../webhook/schemas.js';
import type { AllResidentData } from '../alisClient.js';
import type { AlisPayload } from '../alis/types.js';
import { normalizeMedicalInsurances } from './insuranceNormalization.js';

/**
 * Caspio record type matching exact column names
 */
export type CaspioRecord = {
  Resident_ID?: string;
  Resident_Name?: string;
  DOB?: string;
  SSN?: string;
  Consent?: string;
  Insurance_Name?: string | null;
  Insurance_Type?: string | null;
  Group_?: string | null;
  Insurance_Number?: string | null;
  Insurance_2_Name?: string | null;
  Insurance_2_Type?: string | null;
  Group_2_?: string | null;
  Insurance_Number_2?: string | null;
  Community_Address?: string;
  Room_number?: string;
  Move_in_Date?: string;
  Move_Out_Date?: string;
  Service_Type?: string;
  Service_Start_Date?: string;
  Service_End_Date?: string;
  Fall_Baseline?: string;
  On_Prem?: boolean;
  On_Prem_Date?: string;
  Off_Prem?: boolean;
  Off_Prem_Date?: string;
  Hospice?: boolean;
  Diagnosis1?: string;
  Diagnosis2?: string;
  Family_Contact_1?: string | null;
  Family_Contact_2?: string | null;
  Contact_1_Name?: string | null;
  Contact_2_Name?: string | null;
  Contact_1_Number?: string | null;
  Contact_2_Number?: string | null;
  Contact_1_Email?: string | null;
  Contact_2_Email?: string | null;
  Contact_1_Address?: string | null;
  Contact_2_Address?: string | null;
  CommunityName?: string;
  Community_ID?: number;
  CommunityGroup?: string;
  Neighborhood?: string;
  SerialNumber?: string;
};

export type CommunityTableApiRecord = {
  CUID?: string;
  CommunityID?: string;
  CommunityName?: string;
  Neighborhood?: string;
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  CommunityGroup?: string;
  RoomNumber?: string;
  SerialNumber?: string;
  Sector?: string;
};

export type CarePatientTableApiRecord = {
  PatientNumber?: string;
  PatientSSN?: string;
  LastName?: string;
  FirstName?: string;
  PatientDOB?: string;
  PatientCommunity?: string;
  PatientAddress?: string;
  ApartmentNumber?: string;
  PatientAddressCity?: string;
  PatientAddressState?: string;
  PatientAddressZip?: string;
  PatientPrimaryInsurance?: string | null;
  PrimaryInsuranceNum?: string | null;
  GroupNumber1?: string | null;
  Secondinsurance?: string | null;
  SecondInsuranceNum?: string | null;
  GroupNumber2?: string | null;
  Diagnosis1?: string;
  Diagnosis2?: string;
  PatientPhoneNumber?: string;
  FamilyContact1Name?: string | null;
  FamilyContact1Relationship?: string | null;
  FamilyContact1Number?: string | null;
  FamilyContact1Email?: string | null;
  FamilyContact1Address?: string | null;
  FamilyContact2Name?: string | null;
  FamilyContact2Relationship?: string | null;
  FamilyContact2Number?: string | null;
  FamilyContact2Email?: string | null;
  FamilyContact2Address?: string | null;
  Insurance_Type?: string | null;
  Insurance_2_Type?: string | null;
  Move_in_Date?: string;
  Move_Out_Date?: string;
  Service_Start_Date?: string;
  Service_End_Date?: string;
  Fall_Baseline?: string;
  On_Prem?: boolean;
  On_Prem_Date?: string;
  Off_Prem?: boolean;
  Off_Prem_Date?: string;
  Hospice?: boolean;
  DiagnosisCode?: string;
  CUID?: string;
  CommunityName?: string;
};

export type ServiceTableApiRecord = {
  Service_ID: string;
  PatientNumber?: string;
  CUID?: string;
  Room?: string;
  ServiceType?: string;
  StartDate?: string;
  EndDate?: string;
  CommunityName?: string;
};

export type OffPremHistoryTableRecord = {
  Episode_ID: string;
  PatientNumber: string;
  CUID?: string;
  CommunityName?: string;
  Leave_ID?: string;
  OffPremStart: string;
  OffPremEnd?: string;
  DurationMinutes?: number | null;
  DurationHours?: number | null;
  IsOpen: boolean;
  CloseReason?: string;
  CreatedAtUtc: string;
  UpdatedAtUtc: string;
};

/**
 * Extract date part (YYYY-MM-DD) from ISO date string
 */
function extractDatePart(dateString: string | undefined | null): string | undefined {
  if (!dateString) return undefined;
  try {
    const date = parseISO(dateString);
    if (Number.isNaN(date.getTime())) return undefined;
    return format(date, 'yyyy-MM-dd');
  } catch {
    return undefined;
  }
}

/**
 * Get string value from object with fallback keys
 */
function getStringValue(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Get boolean value from object with fallback keys
 */
function getBooleanValue(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): boolean | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
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

function combineRoomNumberAndBedLetter(record: Record<string, unknown> | undefined): string | undefined {
  const roomNumber = getStringValue(record, ['RoomNumber', 'roomNumber']);
  if (!roomNumber) return undefined;

  const compactRoomNumber = roomNumber.replace(/\s+/g, '');
  if (/[A-Za-z]+$/.test(compactRoomNumber)) {
    return compactRoomNumber;
  }

  const bedLetter = getStringValue(record, ['BedLetter', 'bedLetter']);
  if (!bedLetter) return compactRoomNumber;

  const compactBedLetter = bedLetter.replace(/\s+/g, '').toUpperCase();
  return compactBedLetter ? `${compactRoomNumber}${compactBedLetter}` : compactRoomNumber;
}

/**
 * Get active room assignment room number
 */
function getActiveRoomNumber(
  roomAssignments: Array<Record<string, unknown>> | undefined,
  rooms: Array<Record<string, unknown>> | undefined,
): string | undefined {
  // Prefer active room assignment
  if (roomAssignments && roomAssignments.length > 0) {
    const activeAssignment = roomAssignments.find(
      (ra) =>
        getBooleanValue(ra, ['IsPrimary', 'isPrimary']) === true ||
        getBooleanValue(ra, ['IsActiveAssignment', 'isActiveAssignment']) === true,
    );
    if (activeAssignment) {
      const roomNum = combineRoomNumberAndBedLetter(activeAssignment);
      if (roomNum) return roomNum;
    }
    // Fallback to first assignment
    const firstRoomNum = combineRoomNumberAndBedLetter(roomAssignments[0]);
    if (firstRoomNum) return firstRoomNum;
  }

  // Fallback to rooms array
  if (rooms && rooms.length > 0) {
    const primaryRoom = rooms.find(
      (r) => getBooleanValue(r, ['IsPrimary', 'isPrimary']) === true,
    );
    if (primaryRoom) {
      const roomNum = combineRoomNumberAndBedLetter(primaryRoom);
      if (roomNum) return roomNum;
    }
    // Fallback to first room
    const firstRoomNum = combineRoomNumberAndBedLetter(rooms[0]);
    if (firstRoomNum) return firstRoomNum;
  }

  return undefined;
}

/**
 * Get contact phone number with priority: home > mobile > work
 */
function getContactPhoneNumber(contact: Record<string, unknown> | undefined): string | undefined {
  if (!contact) return undefined;

  // Priority order: homePhone > mobilePhone > workPhone
  // Also check legacy fields for backward compatibility
  return (
    getStringValue(contact, ['homePhone', 'HomePhone']) ||
    getStringValue(contact, ['mobilePhone', 'MobilePhone']) ||
    getStringValue(contact, ['workPhone', 'WorkPhone']) ||
    getStringValue(contact, ['PhoneNumber', 'phoneNumber', 'Phone', 'phone'])
  );
}

/**
 * Combine contact address fields into a single string
 * Format: streetAddress1, streetAddress2, city, state postalCode
 */
function getContactAddress(contact: Record<string, unknown> | undefined): string | undefined {
  if (!contact) return undefined;

  const street1 = getStringValue(contact, ['streetAddress1', 'StreetAddress1', 'Address1', 'address1', 'Address', 'address']);
  const street2 = getStringValue(contact, ['streetAddress2', 'StreetAddress2', 'Address2', 'address2']);
  const city = getStringValue(contact, ['city', 'City']);
  const state = getStringValue(contact, ['state', 'State']);
  const postalCode = getStringValue(contact, ['postalCode', 'PostalCode', 'zipCode', 'ZipCode', 'zip', 'Zip']);

  // If we have the new format fields, combine them
  if (street1 || city || state || postalCode) {
    const addressParts: string[] = [];
    
    // Add street address parts
    if (street1) addressParts.push(street1);
    if (street2) addressParts.push(street2);
    
    // Add city, state, postal code
    // Format: "City, State PostalCode" or "City, State" or "City PostalCode" or just "City"
    const cityStateZipParts: string[] = [];
    if (city) {
      cityStateZipParts.push(city);
    }
    // Add state and postal code together (space-separated)
    const stateZip = [state, postalCode].filter(Boolean).join(' ');
    if (stateZip) {
      cityStateZipParts.push(stateZip);
    }
    
    // Join city and state/zip with comma if both exist, otherwise just join with space
    const cityStateZip = cityStateZipParts.length > 1 
      ? cityStateZipParts.join(', ')
      : cityStateZipParts.join(' ');
    
    if (cityStateZip) {
      addressParts.push(cityStateZip);
    }
    
    return addressParts.length > 0 ? addressParts.join(', ') : undefined;
  }

  // Fallback to legacy address field
  return getStringValue(contact, ['Address', 'address']);
}

function isHospiceContact(contact: Record<string, unknown> | undefined): boolean {
  if (!contact) return false;
  const contactType = getStringValue(contact, [
    'RelationshipType',
    'relationshipType',
    'Relationship',
    'relationship',
    'Type',
    'type',
    'ContactType',
    'contactType',
  ]);
  return contactType ? contactType.toLowerCase().includes('hospice') : false;
}

function isFinanciallyResponsibleContact(
  contact: Record<string, unknown> | undefined,
): boolean {
  if (!contact) return false;
  const tags =
    getStringValue(contact, ['additionalInfoTags', 'AdditionalInfoTags']) ?? '';
  const normalized = tags.toLowerCase();
  return (
    normalized.includes('financial_power_of_attorney') ||
    normalized.includes('emergency')
  );
}

function filterFinancialContacts(
  contacts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return contacts.filter((contact) => isFinanciallyResponsibleContact(contact));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function getResidentRecord(payload: AlisPayload): Record<string, unknown> {
  return payload.data.resident as Record<string, unknown>;
}

function getBasicInfoRecord(payload: AlisPayload): Record<string, unknown> {
  return payload.data.basicInfo as Record<string, unknown>;
}

function getCommunityRecord(payload: AlisPayload): Record<string, unknown> | undefined {
  return payload.data.community as Record<string, unknown> | undefined;
}

function getPatientAddressField(
  resident: Record<string, unknown>,
  basicInfo: Record<string, unknown>,
  residentKeys: string[],
  basicInfoKeys: string[],
): string | undefined {
  return (
    getStringValue(resident, residentKeys) ??
    getStringValue(basicInfo, basicInfoKeys)
  );
}

function sanitizeDiagnosisValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const firstDiagnosis = value.split(',')[0] ?? value;
  const withoutControlChars = firstDiagnosis.replace(/[\u0000-\u001f\u007f]/g, ' ');
  const collapsed = withoutControlChars.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return undefined;
  }

  // Keep values compact and safe for strict Caspio text columns.
  const MAX_DIAGNOSIS_LENGTH = 120;
  return collapsed.slice(0, MAX_DIAGNOSIS_LENGTH);
}

export function mapCommunityRecord(payload: AlisPayload): CommunityTableApiRecord {
  const resident = getResidentRecord(payload);
  const basicInfo = getBasicInfoRecord(payload);
  const community = getCommunityRecord(payload);
  const communityIdString =
    getStringValue(community, ['CommunityID', 'CommunityId', 'communityId']) ??
    getStringValue(resident, ['CommunityId', 'communityId']) ??
    getStringValue(basicInfo, ['CommunityId', 'communityId']);
  const communityIdNumeric =
    getNumericValue(community, ['CommunityID', 'CommunityId', 'communityId']) ??
    getNumericValue(resident, ['CommunityId', 'communityId']) ??
    getNumericValue(basicInfo, ['CommunityId', 'communityId']);
  const communityId =
    communityIdString ?? (communityIdNumeric !== undefined ? String(communityIdNumeric) : undefined);

  const record: CommunityTableApiRecord = {
    CUID:
      getStringValue(community, ['CUID', 'cuid']) ??
      (communityId ? `COMM-${communityId}` : undefined),
    CommunityID: communityId,
    CommunityName: getStringValue(community, ['CommunityName', 'communityName']),
    Neighborhood: getStringValue(community, ['Neighborhood', 'neighborhood']),
    Address: getStringValue(community, ['Address', 'address']),
    City: getStringValue(community, ['City', 'city']),
    State: getStringValue(community, ['State', 'state']),
    Zip: getStringValue(community, ['Zip', 'zip', 'ZipCode', 'zipCode']),
    CommunityGroup: getStringValue(community, ['CommunityGroup', 'communityGroup']),
    RoomNumber: getActiveRoomNumber(
      payload.data.roomAssignments as Array<Record<string, unknown>> | undefined,
      (resident.Rooms || resident.rooms) as Array<Record<string, unknown>> | undefined,
    ),
    SerialNumber: getStringValue(community, ['SerialNumber', 'serialNumber']),
    Sector: getStringValue(community, ['Sector', 'sector']),
  };

  return stripUndefined(record);
}

export function mapPatientRecord(
  payload: AlisPayload,
  community: {
    CUID?: string;
    CommunityName?: string;
  } = {},
): CarePatientTableApiRecord {
  const resident = getResidentRecord(payload);
  const basicInfo = getBasicInfoRecord(payload);
  const residentId = payload.residentId ?? getStringValue(resident, ['ResidentId', 'residentId']);
  const firstName = getStringValue(resident, ['FirstName', 'firstName']);
  const lastName = getStringValue(resident, ['LastName', 'lastName']);
  const dob = extractDatePart(getStringValue(resident, ['DateOfBirth', 'dateOfBirth']));
  const moveInDate = extractDatePart(
    getStringValue(resident, ['PhysicalMoveInDate', 'physicalMoveInDate']) ??
      getStringValue(resident, ['FinancialMoveInDate', 'financialMoveInDate']),
  );
  const apartmentNumber = getActiveRoomNumber(
    payload.data.roomAssignments as Array<Record<string, unknown>> | undefined,
    (resident.Rooms || resident.rooms) as Array<Record<string, unknown>> | undefined,
  );
  const isOnLeave = getBooleanValue(resident, ['IsOnLeave', 'isOnLeave', 'OnLeave', 'onLeave']);

  const contacts = filterFinancialContacts(
    (payload.data.contacts || []) as Array<Record<string, unknown>>,
  );
  const contact1 = contacts[0];
  const contact2 = contacts[1];

  const contact1Name =
    getStringValue(contact1, ['Name', 'name']) ||
    [getStringValue(contact1, ['FirstName', 'firstName']), getStringValue(contact1, ['LastName', 'lastName'])]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    undefined;
  const contact2Name =
    getStringValue(contact2, ['Name', 'name']) ||
    [getStringValue(contact2, ['FirstName', 'firstName']), getStringValue(contact2, ['LastName', 'lastName'])]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    undefined;

  const contact1Relationship = getStringValue(contact1, [
    'RelationshipType',
    'relationshipType',
    'Relationship',
    'relationship',
  ]);
  const contact2Relationship = getStringValue(contact2, [
    'RelationshipType',
    'relationshipType',
    'Relationship',
    'relationship',
  ]);

  const diagnosesFull = payload.data.diagnosesAndAllergiesFull as Record<string, unknown> | undefined | null;
  const diagnosis1 = sanitizeDiagnosisValue(
    getStringValue(diagnosesFull ?? undefined, ['primaryDiagnoses', 'PrimaryDiagnoses']) ??
      getStringValue((payload.data.diagnosesAndAllergies?.[0] as Record<string, unknown>) ?? undefined, [
        'Description',
        'description',
        'Code',
        'code',
      ]),
  );
  const diagnosis2 = sanitizeDiagnosisValue(
    getStringValue(diagnosesFull ?? undefined, ['secondaryDiagnoses', 'SecondaryDiagnoses']) ??
      getStringValue((payload.data.diagnosesAndAllergies?.[1] as Record<string, unknown>) ?? undefined, [
        'Description',
        'description',
        'Code',
        'code',
      ]),
  );

  const { slot1, slot2 } = normalizeMedicalInsurances(payload.data.insurance ?? []);

  const communityPayload = getCommunityRecord(payload);
  const patientAddress = getPatientAddressField(
    resident,
    basicInfo,
    ['Address', 'address', 'StreetAddress', 'streetAddress', 'StreetAddress1', 'streetAddress1'],
    ['Address', 'address', 'StreetAddress', 'streetAddress', 'StreetAddress1', 'streetAddress1'],
  );
  const patientAddressCity = getPatientAddressField(
    resident,
    basicInfo,
    ['City', 'city'],
    ['City', 'city'],
  );
  const patientAddressState = getPatientAddressField(
    resident,
    basicInfo,
    ['State', 'state'],
    ['State', 'state'],
  );
  const patientAddressZip = getPatientAddressField(
    resident,
    basicInfo,
    ['Zip', 'zip', 'ZipCode', 'zipCode', 'PostalCode', 'postalCode'],
    ['Zip', 'zip', 'ZipCode', 'zipCode', 'PostalCode', 'postalCode'],
  );

  const record: CarePatientTableApiRecord = {
    PatientNumber: residentId ? String(residentId) : undefined,
    PatientSSN: getStringValue(resident, ['SSN', 'Ssn', 'ssn']),
    LastName: lastName,
    FirstName: firstName,
    PatientDOB: dob,
    PatientCommunity: community.CommunityName ?? getStringValue(communityPayload, ['CommunityName', 'communityName']),
    ApartmentNumber: apartmentNumber,
    PatientAddress: patientAddress,
    PatientAddressCity: patientAddressCity,
    PatientAddressState: patientAddressState,
    PatientAddressZip: patientAddressZip,
    PatientPrimaryInsurance: slot1?.name ?? null,
    PrimaryInsuranceNum: slot1?.number ?? null,
    GroupNumber1: slot1?.group ?? null,
    Secondinsurance: slot2?.name ?? null,
    SecondInsuranceNum: slot2?.number ?? null,
    GroupNumber2: slot2?.group ?? null,
    Insurance_Type: slot1?.type ?? null,
    Insurance_2_Type: slot2?.type ?? null,
    Diagnosis1: diagnosis1,
    Diagnosis2: diagnosis2,
    PatientPhoneNumber:
      getStringValue(resident, ['Phone', 'phone', 'PhoneNumber', 'phoneNumber']) ?? getContactPhoneNumber(contact1),
    FamilyContact1Name: contact1Name,
    FamilyContact1Relationship: contact1Relationship,
    FamilyContact1Number: getContactPhoneNumber(contact1) ?? null,
    FamilyContact1Email: getStringValue(contact1, ['Email', 'email']) ?? null,
    FamilyContact1Address: getContactAddress(contact1) ?? null,
    FamilyContact2Name: contact2Name ?? null,
    FamilyContact2Relationship: contact2Relationship ?? null,
    FamilyContact2Number: getContactPhoneNumber(contact2) ?? null,
    FamilyContact2Email: getStringValue(contact2, ['Email', 'email']) ?? null,
    FamilyContact2Address: getContactAddress(contact2) ?? null,
    Move_in_Date: moveInDate,
    On_Prem: isOnLeave === undefined ? undefined : !isOnLeave,
    Off_Prem: isOnLeave,
    Off_Prem_Date:
      isOnLeave === true
        ? extractDatePart(
            getStringValue(resident, [
              'OnLeaveStartDateUtc',
              'onLeaveStartDateUtc',
              'OnLeaveStartDate',
              'onLeaveStartDate',
              'LeaveStartDate',
              'leaveStartDate',
            ]),
          )
        : undefined,
    Hospice: contacts.some((contact) => isHospiceContact(contact)),
    DiagnosisCode: getStringValue(basicInfo, ['PrimaryDiagnosisCode', 'primaryDiagnosisCode']),
    CUID: community.CUID,
    CommunityName: community.CommunityName,
  };

  return stripUndefined(record);
}

export function mapServiceRecord(params: {
  patientNumber?: string | number;
  cuid?: string;
  roomNumber?: string;
  serviceType?: string;
  startDate?: string;
  endDate?: string;
  communityName?: string;
  serviceId?: string;
}): ServiceTableApiRecord {
  const patientNumber = params.patientNumber !== undefined ? String(params.patientNumber) : undefined;
  const stableInput = [
    patientNumber ?? '',
    params.cuid ?? '',
    params.serviceType ?? '',
    params.startDate ?? '',
  ].join('|');
  const deterministicServiceId = createHash('sha1').update(stableInput).digest('hex').slice(0, 20);
  return stripUndefined({
    Service_ID: params.serviceId ?? deterministicServiceId,
    PatientNumber: patientNumber,
    CUID: params.cuid,
    Room: params.roomNumber,
    ServiceType: params.serviceType,
    StartDate: params.startDate,
    EndDate: params.endDate,
    CommunityName: params.communityName,
  });
}

function getUtcTimestampNow(): string {
  return new Date().toISOString();
}

function toFiniteDurationMinutes(
  offPremStart: string,
  offPremEnd: string,
): number | null {
  const startMs = Date.parse(offPremStart);
  const endMs = Date.parse(offPremEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }
  const delta = endMs - startMs;
  if (delta < 0) {
    return null;
  }
  return Math.floor(delta / 60000);
}

export function buildOffPremEpisodeId(params: {
  patientNumber: string | number;
  cuid?: string;
  leaveId?: string | number;
  offPremStart: string;
}): string {
  const patientNumber = String(params.patientNumber);
  if (params.leaveId !== undefined && params.leaveId !== null && String(params.leaveId).trim().length > 0) {
    return `leave:${patientNumber}:${params.cuid ?? 'na'}:${String(params.leaveId)}`;
  }
  const stableInput = [patientNumber, params.cuid ?? '', params.offPremStart].join('|');
  const hash = createHash('sha1').update(stableInput).digest('hex').slice(0, 24);
  return `leave:${patientNumber}:${params.cuid ?? 'na'}:${hash}`;
}

export function mapOffPremStartEpisode(params: {
  patientNumber: string | number;
  cuid?: string;
  communityName?: string;
  leaveId?: string | number;
  offPremStart: string;
  episodeId?: string;
}): OffPremHistoryTableRecord {
  const now = getUtcTimestampNow();
  const episodeId =
    params.episodeId ??
    buildOffPremEpisodeId({
      patientNumber: params.patientNumber,
      cuid: params.cuid,
      leaveId: params.leaveId,
      offPremStart: params.offPremStart,
    });
  return stripUndefined({
    Episode_ID: episodeId,
    PatientNumber: String(params.patientNumber),
    CUID: params.cuid,
    CommunityName: params.communityName,
    Leave_ID:
      params.leaveId === undefined || params.leaveId === null
        ? undefined
        : String(params.leaveId),
    OffPremStart: params.offPremStart,
    IsOpen: true,
    CreatedAtUtc: now,
    UpdatedAtUtc: now,
  });
}

export function mapOffPremEndPatch(params: {
  offPremStart: string;
  offPremEnd: string;
  closeReason?: string;
}): Partial<OffPremHistoryTableRecord> {
  const durationMinutes = toFiniteDurationMinutes(params.offPremStart, params.offPremEnd);
  return stripUndefined({
    OffPremEnd: params.offPremEnd,
    DurationMinutes: durationMinutes,
    DurationHours:
      durationMinutes === null ? null : Number((durationMinutes / 60).toFixed(2)),
    IsOpen: false,
    CloseReason: params.closeReason ?? 'leave_end',
    UpdatedAtUtc: getUtcTimestampNow(),
  });
}

/**
 * Map ALIS payload to Caspio record format
 */
export function mapAlisPayloadToCaspioRecord(payload: AlisPayload): CaspioRecord {
  const { data } = payload;
  const resident = data.resident as Record<string, unknown>;
  const basicInfo = data.basicInfo as Record<string, unknown>;

  // Resident_ID - use top-level residentId as primary
  const residentId = payload.residentId ?? getStringValue(resident, ['ResidentId', 'residentId']);

  // Resident_Name
  const firstName = getStringValue(resident, ['FirstName', 'firstName']);
  const lastName = getStringValue(resident, ['LastName', 'lastName']);
  const residentName = [firstName, lastName].filter(Boolean).join(' ').trim() || undefined;

  // DOB
  const dobString = getStringValue(resident, ['DateOfBirth', 'dateOfBirth']);
  const dob = extractDatePart(dobString);

  // Room_number
  const roomNumber = getActiveRoomNumber(
    data.roomAssignments as Array<Record<string, unknown>> | undefined,
    (resident.Rooms || resident.rooms) as Array<Record<string, unknown>> | undefined,
  );

  // Move_in_Date - prefer physicalMoveInDate, fallback to financialMoveInDate
  const physicalMoveIn = getStringValue(resident, [
    'PhysicalMoveInDate',
    'physicalMoveInDate',
    'PhysicalMoveIn',
    'physicalMoveIn',
  ]);
  const financialMoveIn = getStringValue(resident, [
    'FinancialMoveInDate',
    'financialMoveInDate',
    'FinancialMoveIn',
    'financialMoveIn',
  ]);
  const moveInDate = extractDatePart(physicalMoveIn || financialMoveIn);

  // Service_Type
  const serviceType =
    getStringValue(resident, ['ProductType', 'productType']) ||
    getStringValue(basicInfo, ['ProductType', 'productType']);

  // On_Prem / Off_Prem - based on isOnLeave
  const isOnLeave = getBooleanValue(resident, [
    'IsOnLeave',
    'isOnLeave',
    'OnLeave',
    'onLeave',
  ]);
  const onPrem = isOnLeave === undefined ? undefined : !isOnLeave;
  const offPrem = isOnLeave;

  // Off_Prem_Date - if isOnLeave is true
  const offPremDate =
    isOnLeave === true
      ? extractDatePart(
          getStringValue(resident, [
            'OnLeaveStartDateUtc',
            'onLeaveStartDateUtc',
            'OnLeaveStartDate',
            'onLeaveStartDate',
            'LeaveStartDate',
            'leaveStartDate',
          ]),
        )
      : undefined;

  // CommunityName and Community_Address - from community data
  const community = data.community as Record<string, unknown> | undefined | null;
  const communityName = community
    ? getStringValue(community, ['CommunityName', 'communityName'])
    : undefined;

  const communityId =
    getNumericValue(resident, ['CommunityId', 'communityId']) ??
    getNumericValue(basicInfo, ['CommunityId', 'communityId']) ??
    getNumericValue(community ?? undefined, ['CommunityId', 'communityId']);

  // Community_Address - format as "City, State Zip"
  // Normalize city field: if it contains state (e.g., "Chicago - IL"), extract just the city name
  let communityAddress: string | undefined = undefined;
  if (community) {
    let city = getStringValue(community, ['City', 'city']);
    const state = getStringValue(community, ['State', 'state']);
    const zipCode = getStringValue(community, ['ZipCode', 'zipCode', 'Zip', 'zip']);
    
    // If city contains the state abbreviation, extract just the city name
    // Handles formats like "Chicago - IL" or "Chicago IL" -> "Chicago"
    if (city && state && city.toUpperCase().includes(state.toUpperCase())) {
      // Remove state abbreviation and any separators (dash, space, etc.)
      const stateUpper = state.toUpperCase();
      city = city
        .replace(new RegExp(`\\s*-\\s*${stateUpper}\\s*$`, 'i'), '') // Remove " - IL" or "- IL"
        .replace(new RegExp(`\\s+${stateUpper}\\s*$`, 'i'), '') // Remove " IL" at end
        .replace(new RegExp(`^${stateUpper}\\s*-\\s*`, 'i'), '') // Remove "IL - " at start
        .trim();
    }
    
    // Format as "City, State Zip" or "City, State" or "City Zip" or just "City"
    if (city && state && zipCode) {
      communityAddress = `${city}, ${state} ${zipCode}`;
    } else if (city && state) {
      communityAddress = `${city}, ${state}`;
    } else if (city && zipCode) {
      communityAddress = `${city} ${zipCode}`;
    } else if (city) {
      communityAddress = city;
    }
  }

  // Insurance mapping - normalize medical insurances with Medicare-first ordering
  const { slot1, slot2 } = normalizeMedicalInsurances(data.insurance ?? []);

  const insuranceName = slot1?.name ?? null;
  const insuranceType = slot1?.type ?? null;
  const groupNumber = slot1?.group ?? null;
  const insuranceNumber = slot1?.number ?? null;

  const insurance2Name = slot2?.name ?? null;
  const insurance2Type = slot2?.type ?? null;
  const group2Number = slot2?.group ?? null;
  const insurance2Number = slot2?.number ?? null;

  // Diagnoses mapping - prefer primaryDiagnoses and secondaryDiagnoses from full endpoint
  // Fallback to processing array format for backward compatibility
  const diagnosesFull = data.diagnosesAndAllergiesFull as Record<string, unknown> | undefined | null;
  let diagnosis1: string | undefined = undefined;
  let diagnosis2: string | undefined = undefined;

  if (diagnosesFull) {
    // Use primaryDiagnoses and secondaryDiagnoses from full endpoint
    diagnosis1 = getStringValue(diagnosesFull, ['primaryDiagnoses', 'PrimaryDiagnoses']);
    diagnosis2 = getStringValue(diagnosesFull, ['secondaryDiagnoses', 'SecondaryDiagnoses']);
  }

  // Fallback to array format if full endpoint data not available or missing values
  const diagnoses = (data.diagnosesAndAllergies || []) as Array<Record<string, unknown>>;
  if (!diagnosis1 || !diagnosis2) {
    const diagnosisStrings: string[] = [];
    for (const diag of diagnoses) {
      const type = getStringValue(diag, ['Type', 'type'])?.toLowerCase();
      if (type === 'diagnosis' || type === 'dx' || !type) {
        // Prefer Description, fallback to Code
        const desc = getStringValue(diag, ['Description', 'description']);
        const code = getStringValue(diag, ['Code', 'code']);
        const diagStr = desc || code;
        if (diagStr && diagnosisStrings.length < 2) {
          diagnosisStrings.push(diagStr);
        }
      }
    }
    // Only use array values if we don't have values from full endpoint
    if (!diagnosis1) diagnosis1 = diagnosisStrings[0];
    if (!diagnosis2) diagnosis2 = diagnosisStrings[1];
  }

  // Contacts mapping (financially responsible only)
  const contacts = filterFinancialContacts(
    (data.contacts || []) as Array<Record<string, unknown>>,
  );
  const contact1 = contacts[0];
  const contact2 = contacts[1];
  const hospice = contacts.some((contact) => isHospiceContact(contact));

  const contact1Name =
    getStringValue(contact1, ['Name', 'name']) ||
    [getStringValue(contact1, ['FirstName', 'firstName']), getStringValue(contact1, ['LastName', 'lastName'])]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    undefined;
  const contact1Number = getContactPhoneNumber(contact1);
  const contact1Email = getStringValue(contact1, ['Email', 'email']) || undefined;
  const contact1Address = getContactAddress(contact1);

  const contact2Name =
    getStringValue(contact2, ['Name', 'name']) ||
    [getStringValue(contact2, ['FirstName', 'firstName']), getStringValue(contact2, ['LastName', 'lastName'])]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    undefined;
  const contact2Number = getContactPhoneNumber(contact2);
  const contact2Email = getStringValue(contact2, ['Email', 'email']) || undefined;
  const contact2Address = getContactAddress(contact2);

  // Family_Contact_1/2 - optional summary if relationship exists
  const contact1Relationship = getStringValue(contact1, [
    'RelationshipType',
    'relationshipType',
    'Relationship',
    'relationship',
  ]);
  const contact2Relationship = getStringValue(contact2, [
    'RelationshipType',
    'relationshipType',
    'Relationship',
    'relationship',
  ]);

  const record: CaspioRecord = {
    Resident_ID: residentId ? String(residentId) : undefined,
    Resident_Name: residentName,
    DOB: dob,
    Room_number: roomNumber,
    Move_in_Date: moveInDate,
    Service_Type: serviceType,
    On_Prem: onPrem,
    Off_Prem: offPrem,
    Off_Prem_Date: offPremDate,
    Community_ID: communityId,
    CommunityName: communityName,
    Community_Address: communityAddress,
    Insurance_Name: insuranceName,
    Insurance_Type: insuranceType,
    Group_: groupNumber,
    Insurance_Number: insuranceNumber,
    Insurance_2_Name: insurance2Name,
    Insurance_2_Type: insurance2Type,
    Group_2_: group2Number,
    Insurance_Number_2: insurance2Number,
    Diagnosis1: diagnosis1,
    Diagnosis2: diagnosis2,
    Contact_1_Name: contact1Name,
    Contact_1_Number: contact1Number,
    Contact_1_Email: contact1Email,
    Contact_1_Address: contact1Address,
    Contact_2_Name: contact2Name,
    Contact_2_Number: contact2Number,
    Contact_2_Email: contact2Email,
    Contact_2_Address: contact2Address,
    Family_Contact_1: contact1Relationship,
    Family_Contact_2: contact2Relationship,
    Hospice: hospice,
  };

  // Strip undefined keys before returning
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as CaspioRecord;
}

/**
 * Redact sensitive fields for logging (SSN, Insurance_Number, Insurance_Number_2)
 */
export function redactForLogs(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactForLogs);

  const redacted: Record<string, unknown> = {};
  const sensitiveKeys = ['SSN', 'ssn', 'Insurance_Number', 'Insurance_Number_2', 'insurance_number', 'insurance_number_2'];

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.includes(key) || key.toLowerCase().includes('ssn') || key.toLowerCase().includes('insurance_number')) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactForLogs(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Get numeric value from object with fallback keys
 */
function getNumericValue(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
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

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Map move-in event to full Caspio resident record
 * Sets Resident_ID, Move_in_Date, Community_ID, On_Prem/Off_Prem, Service_Type, etc.
 */
export function mapMoveInEventToResidentRecord(
  event: AlisEvent,
  fullResidentData?: AllResidentData,
): CaspioRecord {
  const notificationData = event.NotificationData || {};
  const residentId = getNumericValue(notificationData, ['ResidentId', 'residentId']);
  
  if (!residentId) {
    throw new Error('ResidentId is required in NotificationData for move-in event');
  }

  if (!event.CommunityId) {
    throw new Error('CommunityId is required in event for move-in');
  }

  // Use existing mapper if we have full resident data, otherwise build from event
  let baseRecord: CaspioRecord;
  
  if (fullResidentData) {
    // Construct AlisPayload-like structure for reuse of existing mapper
    const alisPayload: AlisPayload = {
      success: true,
      residentId,
      timestamp: event.EventMessageDate,
      apiBase: '',
      data: {
        resident: fullResidentData.resident,
        basicInfo: fullResidentData.basicInfo,
        insurance: fullResidentData.insurance,
        roomAssignments: fullResidentData.roomAssignments,
        diagnosesAndAllergies: fullResidentData.diagnosesAndAllergies,
        diagnosesAndAllergiesFull: fullResidentData.diagnosesAndAllergiesFull ?? null,
        contacts: fullResidentData.contacts,
        community: fullResidentData.community ?? null,
      },
      counts: {
        insurance: fullResidentData.insurance.length,
        roomAssignments: fullResidentData.roomAssignments.length,
        diagnosesAndAllergies: fullResidentData.diagnosesAndAllergies.length,
        contacts: fullResidentData.contacts.length,
      },
    };
    baseRecord = mapAlisPayloadToCaspioRecord(alisPayload);
  } else {
    // Minimal record from event data only
    baseRecord = {
      Resident_ID: String(residentId),
      Community_ID: event.CommunityId,
      Hospice: false,
    };
  }

  // Override/enhance with event-specific data
  const resident = fullResidentData?.resident as Record<string, unknown> | undefined;
  
  // Resident_ID - always set from NotificationData.ResidentId
  baseRecord.Resident_ID = String(residentId);
  
  // Community_ID - always set from event
  baseRecord.Community_ID = event.CommunityId;
  
  // CommunityName - from event or fullResidentData
  if (fullResidentData?.community) {
    const communityName = getStringValue(
      fullResidentData.community as Record<string, unknown>,
      ['CommunityName', 'communityName'],
    );
    if (communityName) {
      baseRecord.CommunityName = communityName;
    }
  }

  // Move_in_Date - prefer PhysicalMoveInDate, fallback to FinancialMoveInDate
  // Get from NotificationData first, then from resident data
  const physicalMoveIn = 
    getStringValue(notificationData, ['PhysicalMoveInDate', 'physicalMoveInDate']) ||
    (resident ? getStringValue(resident, ['PhysicalMoveInDate', 'physicalMoveInDate']) : undefined);
  const financialMoveIn = 
    getStringValue(notificationData, ['FinancialMoveInDate', 'financialMoveInDate']) ||
    (resident ? getStringValue(resident, ['FinancialMoveInDate', 'financialMoveInDate']) : undefined);
  const moveInDate = extractDatePart(physicalMoveIn || financialMoveIn);
  if (moveInDate) {
    baseRecord.Move_in_Date = moveInDate;
    // On_Prem_Date should be Move_in_Date
    baseRecord.On_Prem_Date = moveInDate;
  }

  // Service_Type - from classification (prefer) or productType
  const classification = resident ? getStringValue(resident, ['Classification', 'classification']) : undefined;
  const productType = resident ? getStringValue(resident, ['ProductType', 'productType']) : undefined;
  if (classification) {
    baseRecord.Service_Type = classification;
  } else if (productType) {
    baseRecord.Service_Type = productType;
  }

  // On_Prem / Off_Prem - derived from isOnLeave
  if (resident) {
    const isOnLeave = getBooleanValue(resident, ['IsOnLeave', 'isOnLeave', 'OnLeave', 'onLeave']);
    if (isOnLeave !== undefined) {
      baseRecord.On_Prem = !isOnLeave;
      baseRecord.Off_Prem = isOnLeave;
      
      // Off_Prem_Date - from onLeaveStartDateUtc if isOnLeave is true
      if (isOnLeave === true) {
        const offPremDate = extractDatePart(
          getStringValue(resident, [
            'OnLeaveStartDateUtc',
            'onLeaveStartDateUtc',
            'OnLeaveStartDate',
            'onLeaveStartDate',
            'LeaveStartDate',
            'leaveStartDate',
          ]),
        );
        if (offPremDate) {
          baseRecord.Off_Prem_Date = offPremDate;
        }
      }
    }
  }

  // Room_number - from NotificationData.RoomsAssigned if available
  const roomsAssigned = notificationData.RoomsAssigned;
  if (Array.isArray(roomsAssigned) && roomsAssigned.length > 0) {
    const firstRoom = roomsAssigned[0] as Record<string, unknown>;
    const roomNumber = getStringValue(firstRoom, ['RoomNumber', 'roomNumber']);
    if (roomNumber) {
      baseRecord.Room_number = roomNumber;
    }
  }

  return baseRecord;
}

/**
 * Map move-out event to vacant record
 * Creates a vacancy row with synthetic Resident_ID
 */
export function mapMoveOutEventToVacantRecord(event: AlisEvent): CaspioRecord {
  const notificationData = event.NotificationData || {};
  const residentId = getNumericValue(notificationData, ['ResidentId', 'residentId']);
  
  if (!residentId) {
    throw new Error('ResidentId is required in NotificationData for move-out event');
  }

  if (!event.CommunityId) {
    throw new Error('CommunityId is required in event for move-out');
  }

  // Get room number from RoomsUnassigned
  const roomNumber = getStringValue(notificationData, ['RoomsUnassigned', 'roomsUnassigned']);
  
  // Synthetic Resident_ID to avoid collisions
  const vacantResidentId = `${residentId}_VACANT_${event.EventMessageId}`;
  
  // Get community name if available from event or will be set later
  const record: CaspioRecord = {
    Resident_ID: vacantResidentId,
    Room_number: roomNumber,
    Community_ID: event.CommunityId,
    Service_Type: 'Vacant',
    Resident_Name: 'Vacant',
    Move_Out_Date: getTodayDateString(),
  };

  return record;
}

/**
 * Map update event to resident patch (partial update)
 * Excludes Move_in_Date (never overwrite), includes Service_Start_Date/Service_End_Date logic
 */
export function mapUpdateEventToResidentPatch(
  event: AlisEvent,
  fullResidentData?: AllResidentData,
  existingRecord?: CaspioRecord,
): Partial<CaspioRecord> {
  const notificationData = event.NotificationData || {};
  const residentId = getNumericValue(notificationData, ['ResidentId', 'residentId']);
  
  if (!residentId) {
    throw new Error('ResidentId is required in NotificationData for update event');
  }

  if (!event.CommunityId) {
    throw new Error('CommunityId is required in event for update');
  }

  // Use existing mapper if we have full resident data
  let updateRecord: Partial<CaspioRecord> = {};
  
  if (fullResidentData) {
    // Construct AlisPayload-like structure for reuse of existing mapper
    const alisPayload: AlisPayload = {
      success: true,
      residentId,
      timestamp: event.EventMessageDate,
      apiBase: '',
      data: {
        resident: fullResidentData.resident,
        basicInfo: fullResidentData.basicInfo,
        insurance: fullResidentData.insurance,
        roomAssignments: fullResidentData.roomAssignments,
        diagnosesAndAllergies: fullResidentData.diagnosesAndAllergies,
        diagnosesAndAllergiesFull: fullResidentData.diagnosesAndAllergiesFull ?? null,
        contacts: fullResidentData.contacts,
        community: fullResidentData.community ?? null,
      },
      counts: {
        insurance: fullResidentData.insurance.length,
        roomAssignments: fullResidentData.roomAssignments.length,
        diagnosesAndAllergies: fullResidentData.diagnosesAndAllergies.length,
        contacts: fullResidentData.contacts.length,
      },
    };
    const fullRecord = mapAlisPayloadToCaspioRecord(alisPayload);

    // Remove Move_in_Date from update unless explicitly requested
    if (event.EventType === 'residents.move_in_out_info_updated') {
      updateRecord = fullRecord;
    } else {
      const { Move_in_Date, ...recordWithoutMoveIn } = fullRecord;
      updateRecord = recordWithoutMoveIn;
    }

    const contacts = filterFinancialContacts(
      (fullResidentData.contacts ?? []) as Array<Record<string, unknown>>,
    );
    if (contacts.length < 2) {
      updateRecord.Contact_2_Name = null;
      updateRecord.Contact_2_Number = null;
      updateRecord.Contact_2_Email = null;
      updateRecord.Contact_2_Address = null;
      updateRecord.Family_Contact_2 = null;
    }
    if (contacts.length < 1) {
      updateRecord.Contact_1_Name = null;
      updateRecord.Contact_1_Number = null;
      updateRecord.Contact_1_Email = null;
      updateRecord.Contact_1_Address = null;
      updateRecord.Family_Contact_1 = null;
    }
  }

  // Always ensure Resident_ID and Community_ID are set
  updateRecord.Resident_ID = String(residentId);
  updateRecord.Community_ID = event.CommunityId;

  // Apply Service_Start_Date and Service_End_Date logic
  const resident = fullResidentData?.resident as Record<string, unknown> | undefined;
  const classification = resident ? getStringValue(resident, ['Classification', 'classification']) : undefined;
  const productType = resident ? getStringValue(resident, ['ProductType', 'productType']) : undefined;
  const serviceType = classification || productType || updateRecord.Service_Type;

  // Service_Start_Date logic
  if (serviceType && existingRecord) {
    const serviceTypeLower = serviceType.toLowerCase();
    if ((serviceTypeLower.includes('detect') || serviceTypeLower.includes('intervene'))) {
      // Only set if Service_Start_Date is empty
      if (!existingRecord.Service_Start_Date) {
        updateRecord.Service_Start_Date = getTodayDateString();
      }
    }
  }

  // Service_End_Date logic - only set on transition to "Declined" or move-out
  if (serviceType && existingRecord) {
    const serviceTypeLower = serviceType.toLowerCase();
    if (serviceTypeLower.includes('declined') && existingRecord.Service_Start_Date) {
      // Only set if Service_End_Date is empty
      if (!existingRecord.Service_End_Date) {
        updateRecord.Service_End_Date = getTodayDateString();
      }
    }
  }

  // Update Service_Type if we have new data
  if (serviceType) {
    updateRecord.Service_Type = serviceType;
  }

  // Update On_Prem / Off_Prem if we have resident data
  if (resident) {
    const isOnLeave = getBooleanValue(resident, ['IsOnLeave', 'isOnLeave', 'OnLeave', 'onLeave']);
    if (isOnLeave !== undefined) {
      updateRecord.On_Prem = !isOnLeave;
      updateRecord.Off_Prem = isOnLeave;
      
      // Off_Prem_Date - from onLeaveStartDateUtc if isOnLeave is true
      if (isOnLeave === true) {
        const offPremDate = extractDatePart(
          getStringValue(resident, [
            'OnLeaveStartDateUtc',
            'onLeaveStartDateUtc',
            'OnLeaveStartDate',
            'onLeaveStartDate',
            'LeaveStartDate',
            'leaveStartDate',
          ]),
        );
        if (offPremDate) {
          updateRecord.Off_Prem_Date = offPremDate;
        }
      }
    }
  }

  const contactFetchFailed = Boolean(fullResidentData?.errors?.contacts);
  if (contactFetchFailed && updateRecord.Hospice === false) {
    delete updateRecord.Hospice;
  }

  if (
    event.EventType === 'resident.contact.created' ||
    event.EventType === 'resident.contact.updated'
  ) {
    const contactType = getStringValue(notificationData, ['ContactType', 'contactType']);
    if (contactType && contactType.toLowerCase().includes('hospice')) {
      updateRecord.Hospice = true;
    }
  }

  // Strip undefined keys
  return Object.fromEntries(
    Object.entries(updateRecord).filter(([, value]) => value !== undefined),
  ) as Partial<CaspioRecord>;
}


