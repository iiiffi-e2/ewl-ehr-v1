import { AxiosError } from 'axios';

import { prisma } from '../db/prisma.js';
import { createHttpClient } from '../config/axios.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

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

    async listCommunities(): Promise<unknown> {
      try {
        const response = await http.get('/v1/integration/communities');
        return response.data;
      } catch (error) {
        throw mapAlisError(error, 'listCommunities');
      }
    },

    async listResidents(params: ListResidentsParams = {}): Promise<ListResidentsResponse> {
      try {
        const response = await http.get('/v1/integration/residents', {
          params: {
            CompanyKey: params.companyKey,
            CommunityId: params.communityId,
            Page: params.page,
            PageSize: params.pageSize,
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
  };
}

export type ListResidentsParams = {
  companyKey?: string;
  communityId?: number;
  page?: number;
  pageSize?: number;
};

export type ListResidentsResponse = {
  residents: AlisResidentDetail[];
  hasMore: boolean;
  raw: unknown;
};

export async function resolveAlisCredentials(
  companyId: number,
  companyKey: string,
): Promise<AlisCredentials> {
  const credential = await prisma.credential.findUnique({
    where: { companyId },
  });

  if (!credential) {
    logger.debug(
      { companyKey },
      'no_custom_credentials_found_using_sandbox_defaults',
    );
    return {
      username: env.ALIS_TEST_USERNAME,
      password: env.ALIS_TEST_PASSWORD,
    };
  }

  logger.warn(
    { companyKey, username: credential.username },
    'credential_record_found_but_password_hash_unusable_for_api_call',
  );
  throw new Error('Stored credentials are hashed; configure runtime secrets for ALIS access.');
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

    const message =
      status === 401
        ? 'Unauthorized to call ALIS API (401)'
        : status === 403
        ? 'Forbidden calling ALIS API (403)'
        : error.message;

    return new AlisApiError(message, status, code);
  }

  return new AlisApiError(`Unexpected ALIS API error during ${action}`);
}
