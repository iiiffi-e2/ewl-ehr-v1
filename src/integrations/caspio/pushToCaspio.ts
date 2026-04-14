import axios from 'axios';

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
import { SERVICE_LINE_DECLINED_CLASSIFICATION } from './serviceLineTypes.js';

import type { AlisPayload } from '../alis/types.js';

type PushToCaspioOptions = {
  skipServiceUpsert?: boolean;
};

function classificationForServiceLineFromPayload(payload: AlisPayload): string {
  const resident = payload.data.resident as Record<string, unknown> | undefined;
  const basicInfo = payload.data.basicInfo as Record<string, unknown> | undefined;
  for (const record of [resident, basicInfo]) {
    if (!record) continue;
    for (const key of ['Classification', 'classification'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return SERVICE_LINE_DECLINED_CLASSIFICATION;
}

function isCommunityCuidConflict(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) {
    return false;
  }
  const data = error.response?.data as Record<string, unknown> | undefined;
  const code = typeof data?.Code === 'string' ? data.Code : '';
  const message = typeof data?.Message === 'string' ? data.Message : '';
  return (
    code === 'SqlServerError' &&
    message.includes("duplicate or blank values are not allowed in field 'CUID'")
  );
}

/**
 * Push ALIS payload to Caspio table
 * Validates payload, maps to new Caspio API table shapes, and upserts by PatientNumber/CUID
 */
export async function pushToCaspio(
  payload: AlisPayload,
  options: PushToCaspioOptions = {},
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
      CUID: enrichment.CUID ?? mappedCommunity.CUID,
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
      try {
        await caspioRequestWithRetry(() =>
          upsertByFields(
            env.CASPIO_COMMUNITY_TABLE_NAME,
            [{ field: 'CommunityID', value: String(communityRecord.CommunityID) }],
            communityRecord,
          ),
        );
      } catch (error) {
        if (!isCommunityCuidConflict(error)) {
          throw error;
        }
        logger.warn(
          {
            residentId,
            communityId: communityRecord.CommunityID,
            cuid: communityRecord.CUID,
            message: error instanceof Error ? error.message : String(error),
          },
          'caspio_community_upsert_skipped_cuid_conflict',
        );
      }
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
        [{ field: 'PatientNumber', value: patientRecord.PatientNumber! }],
        patientRecord as Record<string, unknown>,
      ),
    );

    if (!options.skipServiceUpsert) {
      const serviceType = classificationForServiceLineFromPayload(payload);
      const serviceRecord = mapServiceRecord({
        patientNumber: patientRecord.PatientNumber!,
        cuid: patientRecord.CUID,
        serviceType,
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
    }

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


