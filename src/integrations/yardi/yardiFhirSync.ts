import { format, parseISO } from 'date-fns';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';
import { upsertResident } from '../../domains/residents.js';
import type { CanonicalResidentBundle } from '../ehr/types.js';
import { caspioRequestWithRetry, upsertByFields } from '../caspio/caspioClient.js';
import { getCommunityEnrichment } from '../caspio/caspioCommunityEnrichment.js';
import { mapServiceRecord } from '../caspio/caspioMapper.js';
import { SERVICE_LINE_UNASSIGNED_CLASSIFICATION } from '../caspio/serviceLineTypes.js';

import { YardiFhirClient } from './yardiFhirClient.js';
import {
  getYardiConditionTexts,
  getYardiCoverageNames,
  mapYardiFhirBundleToDemographics,
} from './yardiFhirDemographics.js';
import { getYardiFhirPollCursorKey } from './yardiFhirPollConfig.js';
import type { SyncCursorStore } from './yardiFhirPollCursor.js';
import type { YardiFhirPatientBundle, YardiFhirPollTarget, YardiFhirSyncSummary } from './yardiFhirTypes.js';

export async function runYardiFhirSyncForTarget(
  target: YardiFhirPollTarget,
  options: {
    cursorStore: SyncCursorStore;
    skipCaspio?: boolean;
    client?: YardiFhirClient;
  },
): Promise<YardiFhirSyncSummary> {
  const startedAt = new Date().toISOString();
  const summary: YardiFhirSyncSummary = {
    companyKey: target.companyKey,
    communityId: target.communityId,
    organizationId: target.organizationId,
    startedAt,
    completedAt: startedAt,
    patientsDiscovered: 0,
    patientsProcessed: 0,
    patientsSucceeded: 0,
    patientsFailed: 0,
    errors: [],
  };

  const company = await prisma.company.findUnique({
    where: { companyKey: target.companyKey },
  });
  if (!company) {
    throw new Error(`Company not found for key '${target.companyKey}'`);
  }

  if (
    env.ehrEnabledCommunityIds.length > 0 &&
    !env.ehrEnabledCommunityIds.includes(target.communityId)
  ) {
    logger.info(
      { companyKey: target.companyKey, communityId: target.communityId },
      'yardi_fhir_sync_skipped_community_not_enabled',
    );
    summary.completedAt = new Date().toISOString();
    return summary;
  }

  const client = options.client ?? YardiFhirClient.createConfigured();
  const cursorKey = getYardiFhirPollCursorKey(target);
  const previousPollAt = await options.cursorStore.get(cursorKey);
  const sinceDate =
    previousPollAt ??
    new Date(Date.now() - env.YARDI_FHIR_POLL_INTERVAL_MS).toISOString().slice(0, 10);

  const patientIds = new Set<string>();
  const [activePatientIds, encounterPatientIds] = await Promise.all([
    client.listActivePatientIds(target.organizationId),
    client.listEncounterPatientIdsSince(sinceDate),
  ]);

  for (const patientId of activePatientIds) patientIds.add(patientId);
  for (const patientId of encounterPatientIds) patientIds.add(patientId);

  summary.patientsDiscovered = patientIds.size;

  logger.info(
    {
      companyKey: target.companyKey,
      communityId: target.communityId,
      organizationId: target.organizationId,
      patientsDiscovered: summary.patientsDiscovered,
      sinceDate,
    },
    'yardi_fhir_sync_started',
  );

  for (const patientId of patientIds) {
    summary.patientsProcessed += 1;
    try {
      const bundle = await client.fetchPatientBundle(patientId);
      const residentBundle = buildCanonicalResidentBundle({
        companyId: company.id,
        target,
        bundle,
      });

      await upsertResident(company.id, {
        source: 'yardi-fhir',
        externalResidentId: residentBundle.demographics.externalResidentId,
        alisResidentId: null,
        status: residentBundle.demographics.status ?? 'unknown',
        productType: residentBundle.demographics.productType ?? null,
        classification: residentBundle.demographics.classification ?? null,
        firstName: residentBundle.demographics.firstName ?? null,
        lastName: residentBundle.demographics.lastName ?? null,
        dateOfBirth: residentBundle.demographics.dateOfBirth
          ? new Date(residentBundle.demographics.dateOfBirth)
          : null,
        roomNumber: residentBundle.demographics.roomNumber ?? null,
        bed: residentBundle.demographics.bed ?? null,
        room: residentBundle.demographics.room ?? null,
        updatedAtUtc: residentBundle.demographics.updatedAtUtc
          ? new Date(residentBundle.demographics.updatedAtUtc)
          : null,
        onPrem: residentBundle.demographics.onPrem ?? null,
        onPremDate: residentBundle.demographics.onPremDate
          ? new Date(residentBundle.demographics.onPremDate)
          : null,
        offPrem: residentBundle.demographics.offPrem ?? null,
        offPremDate: residentBundle.demographics.offPremDate
          ? new Date(residentBundle.demographics.offPremDate)
          : null,
      });

      const shouldSkipCaspio =
        options.skipCaspio === true || (env.EHR_SHADOW_MODE && env.EHR_SOURCE !== 'yardi-fhir');

      if (!shouldSkipCaspio) {
        await pushYardiFhirBundleToCaspio(residentBundle, target.communityId);
      }

      summary.patientsSucceeded += 1;
    } catch (error) {
      summary.patientsFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push({ patientId, message });
      logger.warn(
        {
          companyKey: target.companyKey,
          communityId: target.communityId,
          patientId,
          error: message,
        },
        'yardi_fhir_sync_patient_failed',
      );
    }
  }

  await options.cursorStore.set(cursorKey, new Date().toISOString());
  summary.completedAt = new Date().toISOString();

  logger.info(
    {
      companyKey: target.companyKey,
      communityId: target.communityId,
      patientsDiscovered: summary.patientsDiscovered,
      patientsProcessed: summary.patientsProcessed,
      patientsSucceeded: summary.patientsSucceeded,
      patientsFailed: summary.patientsFailed,
    },
    'yardi_fhir_sync_completed',
  );

  return summary;
}

export function buildCanonicalResidentBundle(args: {
  companyId: number;
  target: YardiFhirPollTarget;
  bundle: YardiFhirPatientBundle;
  eventType?: string;
}): CanonicalResidentBundle {
  const eventMessageDate = new Date().toISOString();
  const event = {
    source: 'yardi-fhir' as const,
    companyKey: args.target.companyKey,
    communityId: args.target.communityId,
    eventType: args.eventType ?? 'yardi.poll.sync',
    eventMessageId: `yardi-poll-${args.target.companyKey}-${args.target.communityId}-${args.bundle.patientId}-${eventMessageDate}`,
    eventMessageDate,
    lifecycleKind: 'update' as const,
    notificationData: {
      PatientId: args.bundle.patientId,
      OrganizationId: args.target.organizationId,
    },
    raw: args.bundle,
  };

  return {
    source: 'yardi-fhir',
    companyId: args.companyId,
    companyKey: args.target.companyKey,
    communityId: args.target.communityId,
    residentId: args.bundle.patientId,
    event,
    demographics: mapYardiFhirBundleToDemographics(args.bundle),
    vendorPayload: args.bundle,
    raw: args.bundle,
  };
}

function formatCaspioDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = parseISO(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return format(parsed, 'MM/dd/yyyy');
  } catch {
    return undefined;
  }
}

export async function pushYardiFhirBundleToCaspio(
  bundle: CanonicalResidentBundle,
  communityId: number,
): Promise<void> {
  const vendorPayload = bundle.vendorPayload as YardiFhirPatientBundle | undefined;
  if (!vendorPayload) {
    throw new Error('Missing Yardi FHIR vendor payload for Caspio push');
  }

  const enrichment = await getCommunityEnrichment(communityId, bundle.demographics.roomNumber ?? undefined);
  const coverageNames = getYardiCoverageNames(vendorPayload);
  const conditions = getYardiConditionTexts(vendorPayload);

  const patientRecord = {
    PatientNumber: bundle.demographics.externalResidentId,
    FirstName: bundle.demographics.firstName ?? undefined,
    LastName: bundle.demographics.lastName ?? undefined,
    PatientDOB: formatCaspioDate(bundle.demographics.dateOfBirth),
    RoomNumber: bundle.demographics.roomNumber ?? undefined,
    ApartmentNumber: bundle.demographics.roomNumber ?? undefined,
    PatientPrimaryInsurance: coverageNames[0] ?? undefined,
    Secondinsurance: coverageNames[1] ?? undefined,
    Diagnosis1: conditions[0] ?? undefined,
    Diagnosis2: conditions[1] ?? undefined,
    Move_in_Date: formatCaspioDate(bundle.demographics.onPremDate),
    On_Prem: bundle.demographics.onPrem ?? undefined,
    On_Prem_Date: formatCaspioDate(bundle.demographics.onPremDate),
    Off_Prem: bundle.demographics.offPrem ?? undefined,
    Off_Prem_Date: formatCaspioDate(bundle.demographics.offPremDate),
    CUID: enrichment.CUID,
    CommunityName: enrichment.CommunityName,
    PatientCommunity: enrichment.CommunityName,
  };

  const communityRecord = {
    CommunityID: String(communityId),
    CUID: enrichment.CUID ?? `COMM-${communityId}`,
    CommunityName: enrichment.CommunityName,
    CommunityGroup: enrichment.CommunityGroup,
    Neighborhood: enrichment.Neighborhood,
    SerialNumber: enrichment.SerialNumber,
    Address: enrichment.Address,
    City: enrichment.City,
    State: enrichment.State,
    Zip: enrichment.Zip,
    Sector: enrichment.Sector,
    RoomNumber: bundle.demographics.roomNumber ?? undefined,
  };

  if (communityRecord.CommunityID) {
    await caspioRequestWithRetry(() =>
      upsertByFields(
        env.CASPIO_COMMUNITY_TABLE_NAME,
        [{ field: 'CommunityID', value: communityRecord.CommunityID! }],
        communityRecord,
      ),
    );
  }

  await caspioRequestWithRetry(() =>
    upsertByFields(
      env.CASPIO_TABLE_NAME,
      [{ field: 'PatientNumber', value: patientRecord.PatientNumber! }],
      patientRecord,
    ),
  );

  const serviceType =
    bundle.demographics.classification?.trim() || SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
  const serviceRecord = mapServiceRecord({
    patientNumber: patientRecord.PatientNumber!,
    cuid: patientRecord.CUID,
    serviceType,
    startDate: patientRecord.Move_in_Date,
    endDate: undefined,
    communityName: patientRecord.CommunityName,
    roomNumber: patientRecord.RoomNumber,
  });

  await caspioRequestWithRetry(() =>
    upsertByFields(
      env.CASPIO_SERVICE_TABLE_NAME,
      [{ field: 'Service_ID', value: serviceRecord.Service_ID }],
      serviceRecord,
    ),
  );
}
