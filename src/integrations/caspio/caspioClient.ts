import axios, { type AxiosError, type AxiosResponse } from 'axios';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

type TokenCache = {
  token: string;
  expiresAt: number;
};

export type CommunityTableRecord = {
  CUID?: string;
  CommunityName?: string;
  CommunityID?: number | string;
  Neighborhood?: string;
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  CommunityGroup?: string;
  RoomNumber?: string;
  SerialNumber?: string;
  Sector?: string;
  [key: string]: unknown;
};

export type ServiceTableRecord = {
  Service_ID?: string;
  PatientNumber?: string;
  CUID?: string;
  ServiceType?: string;
  StartDate?: string;
  EndDate?: string;
  CommunityName?: string;
  [key: string]: unknown;
};

let tokenCache: TokenCache | null = null;

const authClient = createHttpClient({
  timeout: env.CASPIO_TIMEOUT_MS,
});

const apiClient = createHttpClient({
  baseURL: env.CASPIO_BASE_URL,
  timeout: env.CASPIO_TIMEOUT_MS,
});

/**
 * Get OAuth access token, refreshing if needed (refresh if <60s remaining)
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const refreshThreshold = 60000; // 60 seconds

  if (tokenCache && tokenCache.expiresAt - now > refreshThreshold) {
    return tokenCache.token;
  }

  // Token expired or doesn't exist, fetch new one
  if (!env.CASPIO_CLIENT_ID || !env.CASPIO_CLIENT_SECRET) {
    throw new Error('CASPIO_CLIENT_ID and CASPIO_CLIENT_SECRET must be set');
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.CASPIO_CLIENT_ID,
    client_secret: env.CASPIO_CLIENT_SECRET,
  });

  try {
    const response = await authClient.post<{
      access_token: string;
      expires_in: number;
      token_type: string;
    }>(env.CASPIO_TOKEN_URL, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const expiresIn = response.data.expires_in ?? 3600;
    tokenCache = {
      token: response.data.access_token,
      expiresAt: now + (expiresIn - 60) * 1000, // Subtract 60s buffer
    };

    logger.debug({ expiresIn }, 'caspio_token_refreshed');
    return tokenCache.token;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      },
      'caspio_token_fetch_failed',
    );
    throw new Error(`Failed to get Caspio access token: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Invalidate the token cache (used on 401 errors)
 */
function invalidateToken(): void {
  tokenCache = null;
}

/**
 * Build filter for REST v3 API to find records by field value
 * Uses query parameter format: ?q={filter}
 */
function buildEqualsFilter(field: string, value: string | number): string {
  // REST v3 uses JSON filter format in query parameter
  const filter = {
    where: {
      [field]: { eq: value },
    },
  };
  return encodeURIComponent(JSON.stringify(filter));
}

/**
 * Build composite filter for REST v3 API to find records by multiple field values
 * Uses query parameter format: ?q={filter}
 * Caspio REST v3 expects conditions directly in the where object
 */
function buildCompositeFilter(filters: Array<{ field: string; value: string | number | boolean }>): string {
  // REST v3 uses JSON filter format - combine conditions directly in where object
  const whereClause: Record<string, { eq: string | number | boolean }> = {};
  for (const f of filters) {
    whereClause[f.field] = { eq: f.value };
  }
  const filter = {
    where: whereClause,
  };
  return encodeURIComponent(JSON.stringify(filter));
}

function extractRecordsFromResponse(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === 'object') {
    const recordData = data as Record<string, unknown>;
    if (Array.isArray(recordData.Result)) {
      return recordData.Result;
    }
    if (Array.isArray(recordData.records)) {
      return recordData.records;
    }
    if (Array.isArray(recordData.data)) {
      return recordData.data;
    }
  }
  return [];
}

function extractRecordId(record: Record<string, unknown>): string | undefined {
  if (record.PK_ID !== undefined) return String(record.PK_ID);
  if (record.PK !== undefined) return String(record.PK);
  if (record._id !== undefined) return String(record._id);
  if (record.id !== undefined) return String(record.id);
  if (record.Id !== undefined) return String(record.Id);
  return undefined;
}

function parseSortableDate(value: unknown): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

function normalizeComparable(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function parseMissingFieldsFromFieldNotFound(
  error: unknown,
): string[] {
  if (!axios.isAxiosError(error)) {
    return [];
  }

  const responseData = error.response?.data as Record<string, unknown> | undefined;
  if (!responseData) {
    return [];
  }

  const code = responseData.Code;
  const message = responseData.Message;
  if (code !== 'FieldNotFound' || typeof message !== 'string') {
    return [];
  }

  const matches = [...message.matchAll(/'([^']+)'/g)];
  if (matches.length === 0) {
    return [];
  }

  return matches
    .map((match) => match[1]?.trim())
    .filter((field): field is string => Boolean(field));
}

function stripUnsupportedFieldsFromRecord(
  record: Record<string, unknown>,
  unsupportedFields: string[],
): { sanitizedRecord: Record<string, unknown>; droppedFields: string[] } {
  if (unsupportedFields.length === 0) {
    return { sanitizedRecord: record, droppedFields: [] };
  }

  const unsupported = new Set(unsupportedFields);
  const sanitizedRecord: Record<string, unknown> = {};
  const droppedFields: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (unsupported.has(key)) {
      droppedFields.push(key);
      continue;
    }
    sanitizedRecord[key] = value;
  }

  return { sanitizedRecord, droppedFields };
}

/**
 * Insert a record into a Caspio table
 */
export async function insertRecord(
  tableName: string,
  record: Record<string, unknown>,
): Promise<AxiosResponse> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records`;

    try {
      return await apiClient.post(url, record, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      const missingFields = parseMissingFieldsFromFieldNotFound(error);
      const { sanitizedRecord, droppedFields } = stripUnsupportedFieldsFromRecord(
        record,
        missingFields,
      );

      if (droppedFields.length === 0 || Object.keys(sanitizedRecord).length === 0) {
        throw error;
      }

      logger.warn(
        {
          tableName,
          droppedFields,
          attemptedFieldCount: Object.keys(record).length,
          retriedFieldCount: Object.keys(sanitizedRecord).length,
        },
        'caspio_retry_insert_without_unsupported_fields',
      );

      return apiClient.post(url, sanitizedRecord, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    }
  });
}

/**
 * Update a record by Caspio record ID
 */
/**
 * Update a record by Caspio PK_ID
 *
 * IMPORTANT: Caspio REST API v3 PUT endpoint requirements:
 * - Parameter: q.where (NOT q) with SQL-like WHERE clause string
 * - Format: q.where=PK_ID=21 (not JSON format like {"PK_ID":21})
 * - Request body: Single object (NOT array like v2 API)
 * - PK_ID cannot be in request body (system-defined, read-only)
 *
 * This differs from v2 API which used:
 * - Endpoint: /rest/v2/tables/{table}/rows
 * - Parameter: q with JSON format {"field":"value"}
 * - Request body: Array of records [payload]
 *
 * @see https://howto.caspio.com/integrate-your-apps/web-services-api/
 */
export async function updateRecordById(
  tableName: string,
  id: string | number,
  record: Record<string, unknown>,
): Promise<AxiosResponse> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();

    // Build WHERE clause for q.where parameter (SQL-like format, not JSON)
    const pkId = typeof id === 'number' ? id : Number(id);
    const whereClause = encodeURIComponent(`PK_ID=${pkId}`);
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records?q.where=${whereClause}`;

    // Remove PK_ID from body - it's system-defined and cannot be modified
    const { PK_ID, ...recordWithoutPK_ID } = record;

    logger.debug(
      {
        tableName,
        id,
        recordKeys: Object.keys(recordWithoutPK_ID),
      },
      'caspio_updating_record_by_id',
    );

    try {
      return await apiClient.put(url, recordWithoutPK_ID, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      const missingFields = parseMissingFieldsFromFieldNotFound(error);
      const { sanitizedRecord, droppedFields } = stripUnsupportedFieldsFromRecord(
        recordWithoutPK_ID,
        missingFields,
      );

      if (droppedFields.length === 0 || Object.keys(sanitizedRecord).length === 0) {
        throw error;
      }

      logger.warn(
        {
          tableName,
          id,
          droppedFields,
          attemptedFieldCount: Object.keys(recordWithoutPK_ID).length,
          retriedFieldCount: Object.keys(sanitizedRecord).length,
        },
        'caspio_retry_update_without_unsupported_fields',
      );

      return apiClient.put(url, sanitizedRecord, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    }
  });
}

/**
 * Find record by Resident_ID and Community_ID (composite key)
 * Returns { found: boolean, id?: string, record?: unknown }
 * This is the centralized helper for composite key lookups aligned to Caspio REST v3 Swagger format
 */
export async function findRecordByFields(
  tableName: string,
  filters: Array<{ field: string; value: string | number | boolean }>,
): Promise<{ found: boolean; id?: string; record?: unknown }> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildCompositeFilter(filters);
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records?q=${filter}`;

    try {
      const response = await apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // REST v3 response format may vary - handle both array and object responses
      let records: unknown[] = [];
      if (Array.isArray(response.data)) {
        records = response.data;
      } else if (response.data && typeof response.data === 'object') {
        // Check for common response wrapper formats
        const data = response.data as Record<string, unknown>;
        if (Array.isArray(data.Result)) {
          records = data.Result;
        } else if (Array.isArray(data.records)) {
          records = data.records;
        } else if (Array.isArray(data.data)) {
          records = data.data;
        }
      }

      if (records.length === 0) {
        return { found: false };
      }

      // Filter records to find exact match for all requested fields.
      // This handles cases where API-side filtering can be permissive.
      const matchingRecord = records.find((rec) => {
        const record = rec as Record<string, unknown>;
        return filters.every(({ field, value }) => {
          const recordValue = record[field];
          return String(recordValue) === String(value);
        });
      }) as Record<string, unknown> | undefined;

      if (!matchingRecord) {
        logger.debug(
          {
            filters,
            matchCount: records.length,
            sampleRecord: records[0] ?? undefined,
          },
          'caspio_no_exact_match_for_filter_set',
        );
        return { found: false };
      }

      // Try common ID field names (Caspio uses PK_ID as primary key)
      let id: string | undefined;
      if (matchingRecord.PK_ID) {
        id = String(matchingRecord.PK_ID);
      } else if (matchingRecord.PK) {
        id = String(matchingRecord.PK);
      } else if (matchingRecord._id) {
        id = String(matchingRecord._id);
      } else if (matchingRecord.id) {
        id = String(matchingRecord.id);
      } else if (matchingRecord.Id) {
        id = String(matchingRecord.Id);
      }

      logger.debug(
        {
            filters,
          extractedPK_ID: id,
        },
        'caspio_found_record_for_filters',
      );

      // If no ID was found, we can't update this record
      if (!id) {
        logger.warn(
          {
            filters,
            recordKeys: Object.keys(matchingRecord),
          },
          'caspio_record_found_but_no_id_field',
        );
        return { found: false };
      }

      if (records.length > 1) {
        logger.warn(
          {
            filters,
            totalMatches: records.length,
            exactMatches: 1,
          },
          'caspio_multiple_matches_found_filters_filtered',
        );
      }

      return {
        found: true,
        id,
        record: matchingRecord,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // 404 could mean "no records found" or "table doesn't exist"
        logger.debug(
          {
            tableName,
            filters,
            url,
          },
          'caspio_record_not_found_404_filters',
        );
        return { found: false };
      }
      throw error;
    }
  });
}

async function findRecordsByFields(
  tableName: string,
  filters: Array<{ field: string; value: string | number | boolean }>,
): Promise<unknown[]> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildCompositeFilter(filters);
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records?q=${filter}`;

    try {
      const response = await apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return extractRecordsFromResponse(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug({ tableName, filters, url }, 'caspio_records_not_found_404_filters');
        return [];
      }
      throw error;
    }
  });
}

/**
 * Backward-compatible helper for Resident_ID + Community_ID composite lookup.
 */
export async function findRecordByResidentIdAndCommunityId(
  tableName: string,
  residentId: string | number,
  communityId: number,
): Promise<{ found: boolean; id?: string; record?: unknown }> {
  return findRecordByFields(tableName, [
    { field: 'Resident_ID', value: String(residentId) },
    { field: 'Community_ID', value: communityId },
  ]);
}

/**
 * Find community lookup record by CommunityID (CommunityTable_API)
 */
export async function findCommunityById(
  communityId: number,
): Promise<{ found: boolean; record?: CommunityTableRecord }> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildEqualsFilter('CommunityID', communityId);
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(env.CASPIO_COMMUNITY_TABLE_NAME)}/records?q=${filter}`;

    try {
      const response = await apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const records = extractRecordsFromResponse(response.data);
      if (records.length === 0) {
        return { found: false };
      }

      const exactMatches = records.filter((rec) => {
        const record = rec as CommunityTableRecord;
        return normalizeComparable(record.CommunityID) === String(communityId);
      }) as CommunityTableRecord[];

      if (exactMatches.length === 0) {
        logger.debug(
          { communityId, matchCount: records.length },
          'caspio_community_id_no_exact_match_after_lookup',
        );
        return { found: false };
      }

      if (records.length > 1) {
        logger.warn(
          { communityId, matchCount: records.length, exactMatchCount: exactMatches.length },
          'caspio_multiple_community_matches_found',
        );
      }

      return {
        found: true,
        record: exactMatches[0],
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug(
          { communityId, url },
          'caspio_community_record_not_found_404',
        );
        return { found: false };
      }
      throw error;
    }
  });
}

/**
 * Find community lookup record by CommunityID + RoomNumber (CommunityTable_API)
 */
export async function findCommunityByIdAndRoomNumber(
  communityId: number,
  roomNumber: string,
): Promise<{ found: boolean; record?: CommunityTableRecord }> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildCompositeFilter([
      { field: 'CommunityID', value: communityId },
      { field: 'RoomNumber', value: roomNumber },
    ]);
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(env.CASPIO_COMMUNITY_TABLE_NAME)}/records?q=${filter}`;

    try {
      const response = await apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const records = extractRecordsFromResponse(response.data);
      if (records.length === 0) {
        return { found: false };
      }

      const normalizedRoom = roomNumber.trim();
      const exactMatches = records.filter((rec) => {
        const record = rec as CommunityTableRecord;
        return (
          normalizeComparable(record.CommunityID) === String(communityId) &&
          normalizeComparable(record.RoomNumber) === normalizedRoom
        );
      }) as CommunityTableRecord[];

      if (exactMatches.length === 0) {
        logger.debug(
          { communityId, roomNumber: normalizedRoom, matchCount: records.length },
          'caspio_community_room_no_exact_match_after_lookup',
        );
        return { found: false };
      }

      if (records.length > 1) {
        logger.warn(
          {
            communityId,
            roomNumber: normalizedRoom,
            matchCount: records.length,
            exactMatchCount: exactMatches.length,
          },
          'caspio_multiple_community_room_matches_found',
        );
      }

      return {
        found: true,
        record: exactMatches[0],
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug(
          { communityId, roomNumber, url },
          'caspio_community_room_record_not_found_404',
        );
        return { found: false };
      }
      throw error;
    }
  });
}

/**
 * Find records by Resident_ID field
 * Returns { found: boolean, id?: string, raw?: any, matches?: number }
 */
export async function findByResidentId(
  tableName: string,
  residentId: string | number,
): Promise<{ found: boolean; id?: string; raw?: unknown; matches?: number }> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildEqualsFilter('Resident_ID', String(residentId));
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records?q=${filter}`;

    try {
      const response = await apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

    // REST v3 response format may vary - handle both array and object responses
    let records: unknown[] = [];
    if (Array.isArray(response.data)) {
      records = response.data;
    } else if (response.data && typeof response.data === 'object') {
      // Check for common response wrapper formats
      const data = response.data as Record<string, unknown>;
      if (Array.isArray(data.Result)) {
        records = data.Result;
      } else if (Array.isArray(data.records)) {
        records = data.records;
      } else if (Array.isArray(data.data)) {
        records = data.data;
      }
    }

    if (records.length === 0) {
      return { found: false };
    }

    // Get the first record's ID (Caspio typically uses a field like "PK" or "_id" or similar)
    // We'll need to extract the ID from the record
    const firstRecord = records[0] as Record<string, unknown>;
    
    // Try common ID field names (Caspio uses PK_ID as primary key)
    let id: string | undefined;
    if (firstRecord.PK_ID) {
      id = String(firstRecord.PK_ID);
    } else if (firstRecord.PK) {
      id = String(firstRecord.PK);
    } else if (firstRecord._id) {
      id = String(firstRecord._id);
    } else if (firstRecord.id) {
      id = String(firstRecord.id);
    } else if (firstRecord.Id) {
      id = String(firstRecord.Id);
    }

    if (records.length > 1) {
      logger.warn(
        {
          residentId: String(residentId),
          matchCount: records.length,
        },
        'caspio_multiple_matches_found',
      );
    }

      return {
        found: true,
        id,
        raw: firstRecord,
        matches: records.length,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // 404 could mean "no records found" or "table doesn't exist"
        // We'll return found: false and let the insert operation determine if table exists
        logger.debug(
          {
            tableName,
            residentId: String(residentId),
            url,
          },
          'caspio_record_not_found_404',
        );
        return { found: false };
      }
      throw error;
    }
  });
}

/**
 * Find records by PatientNumber field.
 */
export async function findByPatientNumber(
  tableName: string,
  patientNumber: string | number,
): Promise<{ found: boolean; id?: string; raw?: unknown; matches?: number }> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildEqualsFilter('PatientNumber', String(patientNumber));
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records?q=${filter}`;

    try {
      const response = await apiClient.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const records = extractRecordsFromResponse(response.data);
      if (records.length === 0) {
        return { found: false };
      }

      const firstRecord = records[0] as Record<string, unknown>;
      const id =
        firstRecord.PK_ID !== undefined
          ? String(firstRecord.PK_ID)
          : firstRecord.PK !== undefined
            ? String(firstRecord.PK)
            : firstRecord._id !== undefined
              ? String(firstRecord._id)
              : firstRecord.id !== undefined
                ? String(firstRecord.id)
                : firstRecord.Id !== undefined
                  ? String(firstRecord.Id)
                  : undefined;

      if (records.length > 1) {
        logger.warn(
          { patientNumber: String(patientNumber), matchCount: records.length },
          'caspio_multiple_matches_found_patient_number',
        );
      }

      return {
        found: true,
        id,
        raw: firstRecord,
        matches: records.length,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug(
          { tableName, patientNumber: String(patientNumber), url },
          'caspio_patient_record_not_found_404',
        );
        return { found: false };
      }
      throw error;
    }
  });
}

export async function findActiveOrLatestServiceRow(params: {
  patientNumber: string;
  cuid: string;
}): Promise<{ found: boolean; id?: string; record?: ServiceTableRecord }> {
  const records = (await findRecordsByFields(env.CASPIO_SERVICE_TABLE_NAME, [
    { field: 'PatientNumber', value: params.patientNumber },
    { field: 'CUID', value: params.cuid },
  ])) as Array<Record<string, unknown>>;

  if (records.length === 0) {
    return { found: false };
  }

  const withIds = records
    .map((record) => ({ record, id: extractRecordId(record) }))
    .filter((entry) => entry.id);

  if (withIds.length === 0) {
    logger.warn(
      { patientNumber: params.patientNumber, cuid: params.cuid, matchCount: records.length },
      'caspio_service_rows_found_without_ids',
    );
    return { found: false };
  }

  const activeRows = withIds.filter(({ record }) => {
    const endDate = record.EndDate;
    return endDate === undefined || endDate === null || (typeof endDate === 'string' && endDate.trim().length === 0);
  });
  const sourceRows = activeRows.length > 0 ? activeRows : withIds;

  sourceRows.sort((a, b) => parseSortableDate(b.record.StartDate) - parseSortableDate(a.record.StartDate));
  const selected = sourceRows[0];
  return {
    found: true,
    id: selected.id,
    record: selected.record as ServiceTableRecord,
  };
}

/**
 * Upsert a record by Resident_ID
 * Updates if found, inserts if not found
 */
export async function upsertByResidentId(
  tableName: string,
  residentId: string | number,
  record: Record<string, unknown>,
): Promise<{ action: 'insert' | 'update'; id?: string }> {
  let searchResult: { found: boolean; id?: string; raw?: unknown; matches?: number };
  
  try {
    searchResult = await findByResidentId(tableName, residentId);
  } catch (error) {
    // If search fails with 404, it might mean the table doesn't exist
    // Try insert anyway - if that also fails with 404, we'll get a better error
    logger.warn(
      {
        tableName,
        residentId: String(residentId),
        error: error instanceof Error ? error.message : String(error),
      },
      'caspio_find_failed_proceeding_to_insert',
    );
    searchResult = { found: false };
  }

  if (searchResult.found && searchResult.id) {
    // Update existing record
    await updateRecordById(tableName, searchResult.id, record);
    return { action: 'update', id: searchResult.id };
  } else {
    // Insert new record
    try {
      const response = await insertRecord(tableName, record);
      
      // Extract ID from response if available (Caspio uses PK_ID as primary key)
      let id: string | undefined;
      const responseData = response.data as Record<string, unknown>;
      if (responseData.PK_ID) {
        id = String(responseData.PK_ID);
      } else if (responseData.PK) {
        id = String(responseData.PK);
      } else if (responseData._id) {
        id = String(responseData._id);
      } else if (responseData.id) {
        id = String(responseData.id);
      } else if (responseData.Id) {
        id = String(responseData.Id);
      }

      return { action: 'insert', id };
    } catch (insertError) {
      // Provide better error message for 404 on insert (likely table doesn't exist)
      if (axios.isAxiosError(insertError) && insertError.response?.status === 404) {
        const errorMessage = `Caspio table '${tableName}' not found (404). Please verify: 1) The table name is correct, 2) The table exists in your Caspio account, 3) Your API credentials have access to this table. Base URL: ${env.CASPIO_BASE_URL}`;
        logger.error(
          {
            tableName,
            baseUrl: env.CASPIO_BASE_URL,
            url: insertError.config?.url,
          },
          'caspio_table_not_found',
        );
        throw new Error(errorMessage);
      }
      throw insertError;
    }
  }
}

/**
 * Upsert a record by Resident_ID + Community_ID
 * Updates if found, inserts if not found
 */
export async function upsertByResidentIdAndCommunityId(
  tableName: string,
  residentId: string | number,
  communityId: number,
  record: Record<string, unknown>,
): Promise<{ action: 'insert' | 'update'; id?: string }> {
  let searchResult: { found: boolean; id?: string; record?: unknown };

  try {
    searchResult = await findRecordByResidentIdAndCommunityId(
      tableName,
      residentId,
      communityId,
    );
  } catch (error) {
    logger.warn(
      {
        tableName,
        residentId: String(residentId),
        communityId,
        error: error instanceof Error ? error.message : String(error),
      },
      'caspio_find_composite_failed_proceeding_to_insert',
    );
    searchResult = { found: false };
  }

  if (searchResult.found && searchResult.id) {
    await updateRecordById(tableName, searchResult.id, record);
    return { action: 'update', id: searchResult.id };
  }

  const response = await insertRecord(tableName, record);

  let id: string | undefined;
  const responseData = response.data as Record<string, unknown>;
  if (responseData.PK_ID) {
    id = String(responseData.PK_ID);
  } else if (responseData.PK) {
    id = String(responseData.PK);
  } else if (responseData._id) {
    id = String(responseData._id);
  } else if (responseData.id) {
    id = String(responseData.id);
  } else if (responseData.Id) {
    id = String(responseData.Id);
  }

  return { action: 'insert', id };
}

/**
 * Upsert by arbitrary exact-match filters.
 */
export async function upsertByFields(
  tableName: string,
  filters: Array<{ field: string; value: string | number | boolean }>,
  record: Record<string, unknown>,
): Promise<{ action: 'insert' | 'update'; id?: string }> {
  let searchResult: { found: boolean; id?: string; record?: unknown };

  try {
    searchResult = await findRecordByFields(tableName, filters);
  } catch (error) {
    logger.warn(
      {
        tableName,
        filters,
        error: error instanceof Error ? error.message : String(error),
      },
      'caspio_find_filters_failed_proceeding_to_insert',
    );
    searchResult = { found: false };
  }

  if (searchResult.found && searchResult.id) {
    await updateRecordById(tableName, searchResult.id, record);
    return { action: 'update', id: searchResult.id };
  }

  const response = await insertRecord(tableName, record);
  const responseData = response.data as Record<string, unknown>;
  const id =
    responseData.PK_ID !== undefined
      ? String(responseData.PK_ID)
      : responseData.PK !== undefined
        ? String(responseData.PK)
        : responseData._id !== undefined
          ? String(responseData._id)
          : responseData.id !== undefined
            ? String(responseData.id)
            : responseData.Id !== undefined
              ? String(responseData.Id)
              : undefined;

  return { action: 'insert', id };
}

export type OffPremHistoryRecord = {
  Episode_ID?: string;
  PatientNumber?: string;
  CUID?: string;
  Leave_ID?: string;
  OffPremStart?: string;
  OffPremEnd?: string;
  DurationMinutes?: number | null;
  DurationHours?: number | null;
  IsOpen?: boolean;
  StartEventMessageId?: string;
  EndEventMessageId?: string;
  SourceSystem?: string;
  CloseReason?: string;
  CreatedAtUtc?: string;
  UpdatedAtUtc?: string;
  [key: string]: unknown;
};

export async function upsertOffPremEpisodeByEpisodeId(
  record: OffPremHistoryRecord,
): Promise<{ action: 'insert' | 'update'; id?: string }> {
  if (!record.Episode_ID) {
    throw new Error('Episode_ID is required to upsert off-prem episode');
  }
  return upsertByFields(
    env.CASPIO_OFF_PREM_HISTORY_TABLE_NAME,
    [{ field: 'Episode_ID', value: String(record.Episode_ID) }],
    record,
  );
}

export async function findOpenOffPremEpisode(params: {
  patientNumber: string;
  cuid?: string;
  leaveId?: string | number;
}): Promise<{ found: boolean; id?: string; record?: OffPremHistoryRecord }> {
  const baseFilters: Array<{ field: string; value: string | number | boolean }> = [
    { field: 'PatientNumber', value: params.patientNumber },
    { field: 'IsOpen', value: true },
  ];
  if (params.cuid) {
    baseFilters.push({ field: 'CUID', value: params.cuid });
  }

  // Prefer exact leave match when Leave_ID is present.
  if (params.leaveId !== undefined && params.leaveId !== null) {
    const leaveFilters = [
      ...baseFilters,
      { field: 'Leave_ID', value: String(params.leaveId) },
    ];
    const exact = await findRecordByFields(env.CASPIO_OFF_PREM_HISTORY_TABLE_NAME, leaveFilters);
    if (exact.found) {
      return { found: true, id: exact.id, record: exact.record as OffPremHistoryRecord };
    }
  }

  // Fallback: latest open episode by patient/community key.
  const fallback = await findRecordByFields(env.CASPIO_OFF_PREM_HISTORY_TABLE_NAME, baseFilters);
  return {
    found: fallback.found,
    id: fallback.id,
    record: fallback.record as OffPremHistoryRecord | undefined,
  };
}

/**
 * Retry wrapper with exponential backoff for 429/5xx/timeouts
 * Also handles 401 with single token refresh + single retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  attempt = 1,
  maxRetries = env.CASPIO_RETRY_MAX,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const isAxiosError = axios.isAxiosError(error);
    const status = isAxiosError ? error.response?.status : undefined;
    const isTimeout = isAxiosError && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT');

    // Handle 401: refresh token once and retry once
    if (status === 401 && attempt === 1) {
      logger.warn({ attempt }, 'caspio_401_refreshing_token');
      invalidateToken();
      return withRetry(operation, attempt + 1, 1); // Only one retry for 401
    }

    // Retry on 429, 5xx, or timeouts
    const shouldRetry =
      (status === 429 || (status !== undefined && status >= 500) || isTimeout) &&
      attempt < maxRetries;

    if (!shouldRetry) {
      throw error;
    }

    const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
    logger.warn(
      {
        attempt,
        maxRetries,
        delay,
        status,
        isTimeout,
      },
      'caspio_retry_after_error',
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(operation, attempt + 1, maxRetries);
  }
}

/**
 * Wrapper for API calls with retry logic
 */
export async function caspioRequestWithRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withRetry(operation);
}

