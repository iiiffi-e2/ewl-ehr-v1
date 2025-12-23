import axios, { type AxiosError, type AxiosResponse } from 'axios';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

type TokenCache = {
  token: string;
  expiresAt: number;
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
function buildCompositeFilter(filters: Array<{ field: string; value: string | number }>): string {
  // REST v3 uses JSON filter format - combine conditions directly in where object
  const whereClause: Record<string, { eq: string | number }> = {};
  for (const f of filters) {
    whereClause[f.field] = { eq: f.value };
  }
  const filter = {
    where: whereClause,
  };
  return encodeURIComponent(JSON.stringify(filter));
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

    return apiClient.post(url, record, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  });
}

/**
 * Update a record by Caspio record ID
 */
export async function updateRecordById(
  tableName: string,
  id: string | number,
  record: Record<string, unknown>,
): Promise<AxiosResponse> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    // According to Caspio REST API v3, PUT endpoint requires a query parameter to identify the record
    // Use PK_ID in a filter query parameter: ?q={"where":{"PK_ID":{"eq":id}}}
    const filter = buildEqualsFilter('PK_ID', typeof id === 'number' ? id : Number(id));
    const url = `/integrations/rest/v3/tables/${encodeURIComponent(tableName)}/records?q=${filter}`;

    // PK_ID is a system-defined field and cannot be included in the request body
    // Remove it from the record if present (it's only used in the query filter)
    const { PK_ID, ...recordWithoutPK_ID } = record;

    // Caspio PUT endpoint expects the request body to be an array of records
    const recordArray = [recordWithoutPK_ID];

    logger.info(
      {
        tableName,
        id,
        url,
        filter,
        recordKeys: Object.keys(recordWithoutPK_ID),
        recordSample: Object.fromEntries(Object.entries(recordWithoutPK_ID).slice(0, 5)), // First 5 fields
      },
      'caspio_updating_record_by_id',
    );

    return apiClient.put(url, recordArray, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  });
}

/**
 * Find record by Resident_ID and Community_ID (composite key)
 * Returns { found: boolean, id?: string, record?: unknown }
 * This is the centralized helper for composite key lookups aligned to Caspio REST v3 Swagger format
 */
export async function findRecordByResidentIdAndCommunityId(
  tableName: string,
  residentId: string | number,
  communityId: number,
): Promise<{ found: boolean; id?: string; record?: unknown }> {
  return caspioRequestWithRetry(async () => {
    const token = await getAccessToken();
    const filter = buildCompositeFilter([
      { field: 'Resident_ID', value: String(residentId) },
      { field: 'Community_ID', value: communityId },
    ]);
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

      // Filter records to find exact match for both Resident_ID and Community_ID
      // This handles cases where the API filter might not work correctly
      const matchingRecord = records.find((rec) => {
        const record = rec as Record<string, unknown>;
        const recordResidentId = record.Resident_ID ?? record.resident_ID ?? record.resident_id;
        const recordCommunityId = record.Community_ID ?? record.community_ID ?? record.community_id;
        
        const residentIdMatches = 
          String(recordResidentId) === String(residentId);
        const communityIdMatches = 
          recordCommunityId === communityId || String(recordCommunityId) === String(communityId);
        
        return residentIdMatches && communityIdMatches;
      }) as Record<string, unknown> | undefined;

      if (!matchingRecord) {
        logger.debug(
          {
            residentId: String(residentId),
            communityId,
            matchCount: records.length,
            sampleRecord: records[0] ? {
              Resident_ID: (records[0] as Record<string, unknown>).Resident_ID,
              Community_ID: (records[0] as Record<string, unknown>).Community_ID,
            } : undefined,
          },
          'caspio_no_exact_match_for_composite_key',
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

      // Add detailed logging to debug PK_ID extraction (using info level so it shows up)
      logger.info(
        {
          residentId: String(residentId),
          communityId,
          extractedPK_ID: id,
          actualPK_ID: matchingRecord.PK_ID,
          actualPK: matchingRecord.PK,
          actual_id: matchingRecord.id,
          recordResident_ID: matchingRecord.Resident_ID,
          recordCommunity_ID: matchingRecord.Community_ID,
          allKeys: Object.keys(matchingRecord).slice(0, 10), // First 10 keys for debugging
        },
        'caspio_extracted_pk_id_for_update',
      );

      // If no ID was found, we can't update this record
      if (!id) {
        logger.warn(
          {
            residentId: String(residentId),
            communityId,
            recordKeys: Object.keys(matchingRecord),
          },
          'caspio_record_found_but_no_id_field',
        );
        return { found: false };
      }

      if (records.length > 1) {
        logger.warn(
          {
            residentId: String(residentId),
            communityId,
            totalMatches: records.length,
            exactMatches: 1,
          },
          'caspio_multiple_matches_found_composite_key_filtered',
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
            residentId: String(residentId),
            communityId,
            url,
          },
          'caspio_record_not_found_404_composite_key',
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

