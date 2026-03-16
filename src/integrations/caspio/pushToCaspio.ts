import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  caspioRequestWithRetry,
  upsertByFields,
} from './caspioClient.js';
import { getCommunityEnrichment } from './caspioCommunityEnrichment.js';
import {
  mapCommunityRecord,
  mapPatientRecord,
  mapServiceRecord,
  redactForLogs,
} from './caspioMapper.js';

import type { AlisPayload } from '../alis/types.js';

/**
 * Push ALIS payload to Caspio table
 * Validates payload, maps to new Caspio API table shapes, and upserts by PatientNumber/CUID
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
    const mappedCommunity = mapCommunityRecord(payload);
    const communityId = Number(mappedCommunity.CommunityID ?? NaN);
    const enrichment =
      Number.isFinite(communityId) && communityId > 0
        ? await getCommunityEnrichment(communityId, mappedCommunity.RoomNumber)
        : {};

    const communityRecord = {
      ...mappedCommunity,
      CUID: mappedCommunity.CUID ?? enrichment.CUID,
      CommunityName: mappedCommunity.CommunityName ?? enrichment.CommunityName,
      CommunityGroup: mappedCommunity.CommunityGroup ?? enrichment.CommunityGroup,
      Neighborhood: mappedCommunity.Neighborhood ?? enrichment.Neighborhood,
      SerialNumber: mappedCommunity.SerialNumber ?? enrichment.SerialNumber,
      Address: mappedCommunity.Address ?? enrichment.Address,
      City: mappedCommunity.City ?? enrichment.City,
      State: mappedCommunity.State ?? enrichment.State,
      Zip: mappedCommunity.Zip ?? enrichment.Zip,
      Sector: mappedCommunity.Sector ?? enrichment.Sector,
    };

    if (communityRecord.CommunityID) {
      await caspioRequestWithRetry(() =>
        upsertByFields(
          env.CASPIO_COMMUNITY_TABLE_NAME,
          [{ field: 'CommunityID', value: String(communityRecord.CommunityID) }],
          communityRecord,
        ),
      );
    }

    const patientRecord = mapPatientRecord(payload, {
      CUID: communityRecord.CUID,
      CommunityName: communityRecord.CommunityName,
    });
    if (!patientRecord.PatientNumber) {
      patientRecord.PatientNumber = residentId;
    }

    const result = await caspioRequestWithRetry(() =>
      upsertByFields(
        env.CASPIO_TABLE_NAME,
        patientRecord.CUID
          ? [
              { field: 'PatientNumber', value: patientRecord.PatientNumber! },
              { field: 'CUID', value: patientRecord.CUID },
            ]
          : [{ field: 'PatientNumber', value: patientRecord.PatientNumber! }],
        patientRecord as Record<string, unknown>,
      ),
    );

    const serviceType = payload.data.resident
      ? ((payload.data.resident as Record<string, unknown>).Classification ??
          (payload.data.resident as Record<string, unknown>).ProductType)
      : undefined;
    const serviceRecord = mapServiceRecord({
      patientNumber: patientRecord.PatientNumber!,
      cuid: patientRecord.CUID,
      serviceType: typeof serviceType === 'string' ? serviceType : undefined,
      startDate: patientRecord.Service_Start_Date ?? patientRecord.Move_in_Date,
      endDate: patientRecord.Service_End_Date,
      communityName: patientRecord.CommunityName,
    });

    await caspioRequestWithRetry(() =>
      upsertByFields(
        env.CASPIO_SERVICE_TABLE_NAME,
        [{ field: 'Service_ID', value: serviceRecord.Service_ID }],
        serviceRecord,
      ),
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
          serviceTableName: env.CASPIO_SERVICE_TABLE_NAME,
        },
        responseData,
        payload: redactForLogs(payload),
      },
      'caspio_push_error',
    );

    throw error;
  }
}


