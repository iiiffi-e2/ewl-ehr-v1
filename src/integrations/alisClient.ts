import { AxiosError } from 'axios';

import { prisma } from '../db/prisma.js';
import { createHttpClient } from '../config/axios.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { decryptSecret } from '../security/credentials.js';

export type AlisCredentials = {
  username: string;
  password: string;
};

export type AlisRoom = {
  RoomNumber?: string;
  roomNumber?: string;
  Bed?: string;
  bed?: string;
  Room?: string;
  room?: string;
  IsPrimary?: boolean;
  isPrimary?: boolean;
  StartDate?: string;
  startDate?: string;
  EndDate?: string;
  endDate?: string;
};

export type AlisResidentDetail = {
  ResidentId: number;
  residentId?: number;
  Status: string;
  status?: string;
  FirstName?: string;
  firstName?: string;
  LastName?: string;
  lastName?: string;
  DateOfBirth?: string;
  dateOfBirth?: string;
  Classification?: string;
  classification?: string;
  ProductType?: string;
  productType?: string;
  Rooms?: AlisRoom[];
  rooms?: AlisRoom[];
  UpdatedAtUtc?: string;
  updatedAtUtc?: string;
  PhysicalMoveInDate?: string;
  physicalMoveInDate?: string;
  PhysicalMoveIn?: string;
  physicalMoveIn?: string;
  FinancialMoveInDate?: string;
  financialMoveInDate?: string;
  FinancialMoveIn?: string;
  financialMoveIn?: string;
  IsOnLeave?: boolean;
  isOnLeave?: boolean;
  OnLeave?: boolean;
  onLeave?: boolean;
  OnLeaveStartDateUtc?: string;
  onLeaveStartDateUtc?: string;
  OnLeaveStartDate?: string;
  onLeaveStartDate?: string;
  LeaveStartDate?: string;
  leaveStartDate?: string;
};

export type AlisResidentBasicInfo = {
  ResidentId: number;
  residentId?: number;
  Classification?: string;
  classification?: string;
  ProductType?: string;
  productType?: string;
  Rooms?: AlisRoom[];
  rooms?: AlisRoom[];
  PhysicalMoveInDate?: string;
  physicalMoveInDate?: string;
  PhysicalMoveIn?: string;
  physicalMoveIn?: string;
  FinancialMoveInDate?: string;
  financialMoveInDate?: string;
  FinancialMoveIn?: string;
  financialMoveIn?: string;
};

export type AlisLeave = {
  LeaveId: number;
  leaveId?: number;
  ResidentId: number;
  residentId?: number;
  StartDate?: string;
  startDate?: string;
  ExpectedReturnDate?: string;
  expectedReturnDate?: string;
  EndDate?: string;
  endDate?: string;
  Reason?: string;
  reason?: string;
  Status?: string;
  status?: string;
};

export type AlisCommunity = {
  CommunityId?: number;
  communityId?: number;
  CommunityName?: string;
  communityName?: string;
  CompanyKey?: string;
  companyKey?: string;
  Address?: string;
  address?: string;
  City?: string;
  city?: string;
  State?: string;
  state?: string;
  ZipCode?: string;
  zipCode?: string;
  Zip?: string;
  zip?: string;
  Phone?: string;
  phone?: string;
};

export type AlisInsurance = {
  InsuranceId?: number;
  insuranceId?: number;
  InsuranceName?: string;
  insuranceName?: string;
  InsuranceType?: string;
  insuranceType?: string;
  GroupNumber?: string;
  groupNumber?: string;
  AccountNumber?: string;
  accountNumber?: string;
  EffectiveDate?: string;
  effectiveDate?: string;
  ExpirationDate?: string;
  expirationDate?: string;
};

export type AlisRoomAssignment = {
  RoomAssignmentId?: number;
  roomAssignmentId?: number;
  RoomNumber?: string;
  roomNumber?: string;
  AssignmentDate?: string;
  assignmentDate?: string;
  StartDate?: string;
  startDate?: string;
  EndDate?: string;
  endDate?: string;
  IsPrimary?: boolean;
  isPrimary?: boolean;
};

export type AlisDiagnosisOrAllergy = {
  DiagnosisId?: number;
  diagnosisId?: number;
  AllergyId?: number;
  allergyId?: number;
  Code?: string;
  code?: string;
  Description?: string;
  description?: string;
  Type?: string;
  type?: string;
  OnsetDate?: string;
  onsetDate?: string;
};

export type AlisDiagnosesAndAllergies = {
  residentId?: number;
  ResidentId?: number;
  structuredDiagnoses?: unknown[];
  StructuredDiagnoses?: unknown[];
  primaryDiagnoses?: string;
  PrimaryDiagnoses?: string;
  secondaryDiagnoses?: string;
  SecondaryDiagnoses?: string;
  diet?: string;
  Diet?: string;
  foodAllergies?: string;
  FoodAllergies?: string;
  medicalAllergies?: string;
  MedicalAllergies?: string;
  isDiabetic?: boolean;
  IsDiabetic?: boolean;
  isIncontinent?: boolean;
  IsIncontinent?: boolean;
  incontinenceNotes?: string | null;
  IncontinenceNotes?: string | null;
};

export type AlisContact = {
  ContactId?: number;
  contactId?: number;
  FirstName?: string;
  firstName?: string;
  LastName?: string;
  lastName?: string;
  Name?: string;
  name?: string;
  RelationshipType?: string;
  relationshipType?: string;
  Relationship?: string;
  relationship?: string;
  PhoneNumber?: string;
  phoneNumber?: string;
  Phone?: string;
  phone?: string;
  Email?: string;
  email?: string;
  Address?: string;
  address?: string;
  Address1?: string;
  address1?: string;
  Address2?: string;
  address2?: string;
  City?: string;
  city?: string;
  State?: string;
  state?: string;
  ZipCode?: string;
  zipCode?: string;
  IsPrimaryContact?: boolean;
  isPrimaryContact?: boolean;
};

export class AlisApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'AlisApiError';
    this.status = status;
    this.code = code;
  }
}

export function createAlisClient(credentials: AlisCredentials) {
  const http = createHttpClient({
    baseURL: env.ALIS_API_BASE,
    headers: {
      Accept: 'application/json',
    },
    auth: {
      username: credentials.username,
      password: credentials.password,
    },
  });

  return {
    async getResident(residentId: number): Promise<AlisResidentDetail> {
      try {
        const response = await http.get<AlisResidentDetail>(
          `/v1/integration/residents/${residentId}`,
        );
        return response.data;
      } catch (error) {
        throw mapAlisError(error, 'getResident');
      }
    },

    async getResidentBasicInfo(residentId: number): Promise<AlisResidentBasicInfo> {
      try {
        const response = await http.get<AlisResidentBasicInfo>(
          `/v1/integration/residents/${residentId}/basicInfo`,
        );
        return response.data;
      } catch (error) {
        throw mapAlisError(error, 'getResidentBasicInfo');
      }
    },

    async getResidentLeaves(residentId: number): Promise<AlisLeave[]> {
      try {
        const response = await http.get<{ Leaves?: AlisLeave[] }>(
          `/v1/integration/residents/${residentId}/leaves`,
        );
        const leaves = response.data?.Leaves ?? (response.data as unknown as AlisLeave[]);
        if (Array.isArray(leaves)) {
          return leaves;
        }
        return [];
      } catch (error) {
        throw mapAlisError(error, 'getResidentLeaves');
      }
    },

    async getLeave(leaveId: number): Promise<AlisLeave> {
      try {
        const response = await http.get<AlisLeave>(`/v1/integration/leaves/${leaveId}`);
        return response.data;
      } catch (error) {
        throw mapAlisError(error, 'getLeave');
      }
    },

    async getCommunities(): Promise<AlisCommunity[]> {
      try {
        const response = await http.get<AlisCommunity[]>('/v1/integration/communities');
        return response.data;
      } catch (error) {
        throw mapAlisError(error, 'getCommunities');
      }
    },

    async listCommunities(): Promise<AlisCommunity[]> {
      return this.getCommunities();
    },

    async listResidents(params: ListResidentsParams = {}): Promise<ListResidentsResponse> {
      try {
        const response = await http.get('/v1/integration/residents', {
          params: {
            companyKey: params.companyKey,
            communityId: params.communityId,
            page: params.page,
            pageSize: params.pageSize,
            status: params.status,
          },
        });

        const data = response.data as {
          Residents?: AlisResidentDetail[];
          residents?: AlisResidentDetail[];
          Page?: number;
          TotalPages?: number;
          HasMore?: boolean;
        };

        const residents = data.Residents ?? data.residents ?? [];
        const page = data.Page ?? params.page ?? 1;
        const totalPages = data.TotalPages ?? page;
        const hasMore =
          typeof data.HasMore === 'boolean'
            ? data.HasMore
            : page < totalPages || residents.length === (params.pageSize ?? residents.length);

        return {
          residents,
          hasMore,
          raw: response.data,
        };
      } catch (error) {
        throw mapAlisError(error, 'listResidents');
      }
    },

    async getResidentInsurance(residentId: number): Promise<AlisInsurance[]> {
      try {
        const response = await http.get<{ Insurance?: AlisInsurance[] }>(
          `/v1/integration/residents/${residentId}/insurance`,
        );
        const insurance = response.data?.Insurance ?? (response.data as unknown as AlisInsurance[]);
        if (Array.isArray(insurance)) {
          return insurance;
        }
        return [];
      } catch (error) {
        throw mapAlisError(error, 'getResidentInsurance');
      }
    },

    async getResidentRoomAssignments(residentId: number): Promise<AlisRoomAssignment[]> {
      try {
        const response = await http.get<{ RoomAssignments?: AlisRoomAssignment[] }>(
          `/v1/integration/residents/${residentId}/roomAssignments`,
        );
        const roomAssignments =
          response.data?.RoomAssignments ?? (response.data as unknown as AlisRoomAssignment[]);
        if (Array.isArray(roomAssignments)) {
          return roomAssignments;
        }
        return [];
      } catch (error) {
        throw mapAlisError(error, 'getResidentRoomAssignments');
      }
    },

    async getResidentDiagnosesAndAllergies(
      residentId: number,
    ): Promise<AlisDiagnosisOrAllergy[]> {
      try {
        const response = await http.get<{ DiagnosesAndAllergies?: AlisDiagnosisOrAllergy[] }>(
          `/v1/integration/residents/${residentId}/diagnosesAndAllergies`,
        );
        const diagnosesAndAllergies =
          response.data?.DiagnosesAndAllergies ??
          (response.data as unknown as AlisDiagnosisOrAllergy[]);
        if (Array.isArray(diagnosesAndAllergies)) {
          return diagnosesAndAllergies;
        }
        return [];
      } catch (error) {
        throw mapAlisError(error, 'getResidentDiagnosesAndAllergies');
      }
    },

    async getResidentDiagnosesAndAllergiesFull(
      residentId: number,
    ): Promise<AlisDiagnosesAndAllergies> {
      try {
        const response = await http.get<AlisDiagnosesAndAllergies>(
          `/v1/integration/residents/${residentId}/diagnosesAndAllergies`,
        );
        return response.data;
      } catch (error) {
        throw mapAlisError(error, 'getResidentDiagnosesAndAllergiesFull');
      }
    },

    async getResidentContacts(residentId: number): Promise<AlisContact[]> {
      try {
        const response = await http.get<{ Contacts?: AlisContact[] }>(
          `/v1/integration/residents/${residentId}/contacts`,
        );
        const contacts = response.data?.Contacts ?? (response.data as unknown as AlisContact[]);
        if (Array.isArray(contacts)) {
          return contacts;
        }
        return [];
      } catch (error) {
        throw mapAlisError(error, 'getResidentContacts');
      }
    },
  };
}

export type ListResidentsParams = {
  companyKey?: string;
  communityId?: number;
  page?: number;
  pageSize?: number;
  status?: string;
};

export type ListResidentsResponse = {
  residents: AlisResidentDetail[];
  hasMore: boolean;
  raw: unknown;
};

export type AllResidentData = {
  resident: AlisResidentDetail;
  basicInfo: AlisResidentBasicInfo;
  insurance: AlisInsurance[];
  roomAssignments: AlisRoomAssignment[];
  diagnosesAndAllergies: AlisDiagnosisOrAllergy[];
  diagnosesAndAllergiesFull?: AlisDiagnosesAndAllergies | null;
  contacts: AlisContact[];
  community?: AlisCommunity | null;
  errors?: {
    insurance?: string;
    roomAssignments?: string;
    diagnosesAndAllergies?: string;
    diagnosesAndAllergiesFull?: string;
    contacts?: string;
    community?: string;
  };
};

export async function resolveAlisCredentials(
  companyId: number,
  companyKey: string,
): Promise<AlisCredentials> {
  const alisCredential = await prisma.alisCredential.findUnique({
    where: { companyId },
  });

  if (alisCredential) {
    try {
      return {
        username: alisCredential.username,
        password: decryptSecret(
          alisCredential.passwordCiphertext,
          alisCredential.passwordIv,
        ),
      };
    } catch (error) {
      logger.error(
        { companyKey, error: error instanceof Error ? error.message : String(error) },
        'alis_credential_decryption_failed',
      );
      throw new Error('Failed to decrypt ALIS credentials.');
    }
  }

  if (!alisCredential) {
    logger.warn(
      { companyKey },
      'no_custom_credentials_found_using_sandbox_defaults',
    );
    return {
      username: env.ALIS_TEST_USERNAME,
      password: env.ALIS_TEST_PASSWORD,
    };
  }

  throw new Error('ALIS credential resolution failed unexpectedly.');
}

export async function fetchAllResidentData(
  credentials: AlisCredentials,
  residentId: number,
  communityId?: number | null,
): Promise<AllResidentData> {
  const client = createAlisClient(credentials);

  // Fetch basic resident info first (these are required)
  const [resident, basicInfo] = await Promise.all([
    client.getResident(residentId),
    client.getResidentBasicInfo(residentId),
  ]);

  // Extract communityId from resident data if not provided
  let resolvedCommunityId = communityId;
  if (!resolvedCommunityId) {
    const residentRecord = resident as Record<string, unknown>;
    const idFromResident =
      residentRecord.communityId ?? residentRecord.CommunityId ?? null;
    if (idFromResident !== null) {
      resolvedCommunityId =
        typeof idFromResident === 'number'
          ? idFromResident
          : typeof idFromResident === 'string'
            ? Number(idFromResident)
            : null;
      if (!Number.isFinite(resolvedCommunityId)) {
        resolvedCommunityId = null;
      }
    }
  }

  // Fetch additional data with graceful error handling
  const errors: AllResidentData['errors'] = {};

  const [insurance, roomAssignments, diagnosesAndAllergies, diagnosesAndAllergiesFull, contacts, communitiesResult] =
    await Promise.allSettled([
      client.getResidentInsurance(residentId),
      client.getResidentRoomAssignments(residentId),
      client.getResidentDiagnosesAndAllergies(residentId),
      client.getResidentDiagnosesAndAllergiesFull(residentId),
      client.getResidentContacts(residentId),
      // Fetch communities if communityId is available (from parameter or resident data)
      resolvedCommunityId ? client.getCommunities() : Promise.resolve([]),
    ]);

  const insuranceData = insurance.status === 'fulfilled' ? insurance.value : [];
  if (insurance.status === 'rejected') {
    errors.insurance = insurance.reason?.message ?? 'Failed to fetch insurance';
    logger.warn(
      { residentId, error: insurance.reason?.message },
      'failed_to_fetch_resident_insurance',
    );
  }

  const roomAssignmentsData = roomAssignments.status === 'fulfilled' ? roomAssignments.value : [];
  if (roomAssignments.status === 'rejected') {
    errors.roomAssignments = roomAssignments.reason?.message ?? 'Failed to fetch room assignments';
    logger.warn(
      { residentId, error: roomAssignments.reason?.message },
      'failed_to_fetch_resident_room_assignments',
    );
  }

  const diagnosesAndAllergiesData =
    diagnosesAndAllergies.status === 'fulfilled' ? diagnosesAndAllergies.value : [];
  if (diagnosesAndAllergies.status === 'rejected') {
    errors.diagnosesAndAllergies =
      diagnosesAndAllergies.reason?.message ?? 'Failed to fetch diagnoses and allergies';
    logger.warn(
      { residentId, error: diagnosesAndAllergies.reason?.message },
      'failed_to_fetch_resident_diagnoses_and_allergies',
    );
  }

  const diagnosesAndAllergiesFullData =
    diagnosesAndAllergiesFull.status === 'fulfilled' ? diagnosesAndAllergiesFull.value : null;
  if (diagnosesAndAllergiesFull.status === 'rejected') {
    errors.diagnosesAndAllergiesFull =
      diagnosesAndAllergiesFull.reason?.message ?? 'Failed to fetch diagnoses and allergies full';
    logger.warn(
      { residentId, error: diagnosesAndAllergiesFull.reason?.message },
      'failed_to_fetch_resident_diagnoses_and_allergies_full',
    );
  }

  const contactsData = contacts.status === 'fulfilled' ? contacts.value : [];
  if (contacts.status === 'rejected') {
    errors.contacts = contacts.reason?.message ?? 'Failed to fetch contacts';
    logger.warn(
      { residentId, error: contacts.reason?.message },
      'failed_to_fetch_resident_contacts',
    );
  }

  // Find the matching community if communityId is available
  let communityData: AlisCommunity | null = null;
  if (resolvedCommunityId && communitiesResult.status === 'fulfilled') {
    const communities = communitiesResult.value;
    communityData =
      communities.find(
        (c) =>
          (c.CommunityId ?? c.communityId) === resolvedCommunityId ||
          Number(c.CommunityId ?? c.communityId) === Number(resolvedCommunityId),
      ) ?? null;
    if (!communityData) {
      errors.community = `Community with ID ${resolvedCommunityId} not found`;
      logger.warn({ residentId, communityId: resolvedCommunityId }, 'community_not_found');
    }
  } else if (resolvedCommunityId && communitiesResult.status === 'rejected') {
    errors.community =
      communitiesResult.reason?.message ?? 'Failed to fetch communities';
    logger.warn(
      { residentId, communityId: resolvedCommunityId, error: communitiesResult.reason?.message },
      'failed_to_fetch_communities',
    );
  }

  return {
    resident,
    basicInfo,
    insurance: insuranceData,
    roomAssignments: roomAssignmentsData,
    diagnosesAndAllergies: diagnosesAndAllergiesData,
    diagnosesAndAllergiesFull: diagnosesAndAllergiesFullData,
    contacts: contactsData,
    community: communityData,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
}

export async function verifyAlisConnectivity(): Promise<void> {
  const credentials: AlisCredentials = {
    username: env.ALIS_TEST_USERNAME,
    password: env.ALIS_TEST_PASSWORD,
  };
  const client = createAlisClient(credentials);
  await client.listCommunities();
}

function mapAlisError(error: unknown, action: string): AlisApiError {
  if (error instanceof AlisApiError) {
    return error;
  }

  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const code = error.code;
    const responseData = error.response?.data;

    let message: string;
    if (status === 401) {
      message = 'Unauthorized to call ALIS API (401) - Check ALIS credentials';
    } else if (status === 403) {
      message = 'Forbidden calling ALIS API (403) - Insufficient permissions';
    } else if (status === 404) {
      message = `ALIS API endpoint not found (404) - Endpoint may not exist or credentials lack access. URL: ${error.config?.url}`;
    } else if (responseData && typeof responseData === 'object') {
      // Include ALIS API error details if available
      const alisMessage = (responseData as any).message || (responseData as any).error;
      message = alisMessage
        ? `ALIS API error (${status}): ${alisMessage}`
        : error.message;
    } else {
      message = error.message;
    }

    logger.error(
      {
        action,
        status,
        code,
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        responseData,
      },
      'alis_api_error_details',
    );

    return new AlisApiError(message, status, code);
  }

  return new AlisApiError(`Unexpected ALIS API error during ${action}`);
}
