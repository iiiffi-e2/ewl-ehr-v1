import { parseISO, format } from 'date-fns';

import type { AlisPayload } from '../alis/types.js';

/**
 * Caspio record type matching exact column names
 */
export type CaspioRecord = {
  Resident_ID?: string;
  Resident_Name?: string;
  DOB?: string;
  SSN?: string;
  Consent?: string;
  Insurance_Name?: string;
  Insurance_Type?: string;
  Group_?: string;
  Insurance_Number?: string;
  Insurance_2_Name?: string;
  Insurance_2_Type?: string;
  Group_2_?: string;
  Insurance_Number_2?: string;
  Community_Address?: string;
  Room_number?: string;
  Move_in_Date?: string;
  Service_Type?: string;
  Fall_Baseline?: string;
  On_Prem?: boolean;
  On_Prem_Date?: string;
  Off_Prem?: boolean;
  Off_Prem_Date?: string;
  Hospice?: string;
  Diagnosis1?: string;
  Diagnosis2?: string;
  Family_Contact_1?: string;
  Family_Contact_2?: string;
  Contact_1_Name?: string;
  Contact_2_Name?: string;
  Contact_1_Number?: string;
  Contact_2_Number?: string;
  Contact_1_Email?: string;
  Contact_2_Email?: string;
  Contact_1_Address?: string;
  Contact_2_Address?: string;
  CommunityName?: string;
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
      const roomNum = getStringValue(activeAssignment, ['RoomNumber', 'roomNumber']);
      if (roomNum) return roomNum;
    }
    // Fallback to first assignment
    const firstRoomNum = getStringValue(roomAssignments[0], ['RoomNumber', 'roomNumber']);
    if (firstRoomNum) return firstRoomNum;
  }

  // Fallback to rooms array
  if (rooms && rooms.length > 0) {
    const primaryRoom = rooms.find(
      (r) => getBooleanValue(r, ['IsPrimary', 'isPrimary']) === true,
    );
    if (primaryRoom) {
      const roomNum = getStringValue(primaryRoom, ['RoomNumber', 'roomNumber']);
      if (roomNum) return roomNum;
    }
    // Fallback to first room
    const firstRoomNum = getStringValue(rooms[0], ['RoomNumber', 'roomNumber']);
    if (firstRoomNum) return firstRoomNum;
  }

  return undefined;
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

  // Community_Address - format as "City, State Zip"
  let communityAddress: string | undefined = undefined;
  if (community) {
    const city = getStringValue(community, ['City', 'city']);
    const state = getStringValue(community, ['State', 'state']);
    const zipCode = getStringValue(community, ['ZipCode', 'zipCode', 'Zip', 'zip']);
    const addressParts: string[] = [];
    if (city) addressParts.push(city);
    if (state) addressParts.push(state);
    if (zipCode) addressParts.push(zipCode);
    if (addressParts.length > 0) {
      // Format as "City, State Zip"
      if (addressParts.length === 3) {
        communityAddress = `${addressParts[0]}, ${addressParts[1]} ${addressParts[2]}`;
      } else if (addressParts.length === 2) {
        communityAddress = addressParts.join(', ');
      } else {
        communityAddress = addressParts[0];
      }
    }
  }

  // Insurance mapping
  const insurance = (data.insurance || []) as Array<Record<string, unknown>>;
  const insurance1 = insurance[0];
  const insurance2 = insurance[1];

  const insuranceName = getStringValue(insurance1, ['InsuranceName', 'insuranceName']);
  const insuranceType = getStringValue(insurance1, ['InsuranceType', 'insuranceType']);
  const groupNumber = getStringValue(insurance1, ['GroupNumber', 'groupNumber']);
  const insuranceNumber = getStringValue(insurance1, [
    'AccountNumber',
    'accountNumber',
    'InsuranceNumber',
    'insuranceNumber',
  ]);

  const insurance2Name = getStringValue(insurance2, ['InsuranceName', 'insuranceName']);
  const insurance2Type = getStringValue(insurance2, ['InsuranceType', 'insuranceType']);
  const group2Number = getStringValue(insurance2, ['GroupNumber', 'groupNumber']);
  const insurance2Number = getStringValue(insurance2, [
    'AccountNumber',
    'accountNumber',
    'InsuranceNumber',
    'insuranceNumber',
  ]);

  // Diagnoses mapping - take first two diagnosis-like strings
  const diagnoses = (data.diagnosesAndAllergies || []) as Array<Record<string, unknown>>;
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
  const diagnosis1 = diagnosisStrings[0];
  const diagnosis2 = diagnosisStrings[1];

  // Contacts mapping
  const contacts = (data.contacts || []) as Array<Record<string, unknown>>;
  const contact1 = contacts[0];
  const contact2 = contacts[1];

  const contact1Name =
    getStringValue(contact1, ['Name', 'name']) ||
    [getStringValue(contact1, ['FirstName', 'firstName']), getStringValue(contact1, ['LastName', 'lastName'])]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    undefined;
  const contact1Number =
    getStringValue(contact1, ['PhoneNumber', 'phoneNumber', 'Phone', 'phone']) || undefined;
  const contact1Email = getStringValue(contact1, ['Email', 'email']) || undefined;
  const contact1Address =
    getStringValue(contact1, ['Address', 'address', 'Address1', 'address1']) || undefined;

  const contact2Name =
    getStringValue(contact2, ['Name', 'name']) ||
    [getStringValue(contact2, ['FirstName', 'firstName']), getStringValue(contact2, ['LastName', 'lastName'])]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    undefined;
  const contact2Number =
    getStringValue(contact2, ['PhoneNumber', 'phoneNumber', 'Phone', 'phone']) || undefined;
  const contact2Email = getStringValue(contact2, ['Email', 'email']) || undefined;
  const contact2Address =
    getStringValue(contact2, ['Address', 'address', 'Address1', 'address1']) || undefined;

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


