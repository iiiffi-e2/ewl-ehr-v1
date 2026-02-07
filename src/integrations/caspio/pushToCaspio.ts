import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { caspioRequestWithRetry, upsertByResidentId } from './caspioClient.js';
import { mapAlisPayloadToCaspioRecord, redactForLogs } from './caspioMapper.js';

import type { AlisPayload } from '../alis/types.js';

/**
 * Push ALIS payload to Caspio table
 * Validates payload, maps to Caspio format, and upserts by Resident_ID
 */
export async function pushToCaspio(
  payload: AlisPayload,
): Promise<{ action: 'insert' | 'update'; id?: string }> {
  // Validate payload
  if (payload.success !== true) {
    throw new Error(`Invalid payload: success must be true, got ${payload.success}`);
  }

  if (!payload.residentId) {
    throw new Error('Invalid payload: residentId is required');
  }

  const residentId = String(payload.residentId);

  logger.info({ residentId }, 'caspio_push_start');

  try {
    // Map ALIS payload to Caspio record format
    const record = mapAlisPayloadToCaspioRecord(payload);

    // Ensure Resident_ID is set
    if (!record.Resident_ID) {
      record.Resident_ID = residentId;
    }

    // Upsert record by Resident_ID
    const result = await caspioRequestWithRetry(() =>
      upsertByResidentId(env.CASPIO_TABLE_NAME, record.Resident_ID!, record),
    );

    logger.info(
      {
        residentId,
        action: result.action,
        caspioId: result.id,
      },
      'caspio_push_success',
    );

    return result;
  } catch (error) {
    const status = error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
    const responseData = error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { data?: unknown } }).response?.data
      : undefined;
    const message = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        residentId,
        status,
        message,
        caspio: {
          baseUrl: env.CASPIO_BASE_URL,
          tableName: env.CASPIO_TABLE_NAME,
        },
        responseData,
        payload: redactForLogs(payload),
      },
      'caspio_push_error',
    );

    throw error;
  }
}


