import axios from 'axios';
import { format, parseISO } from 'date-fns';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';
import { upsertResident } from '../../domains/residents.js';
import type { CanonicalResidentBundle } from '../ehr/types.js';
import { caspioRequestWithRetry, upsertByFields, upsertPatientByPatientNumber } from '../caspio/caspioClient.js';
import {
  getCommunityEnrichment,
  type CommunityEnrichment,
} from '../caspio/caspioCommunityEnrichment.js';
import { mapServiceRecord } from '../caspio/caspioMapper.js';
import { SERVICE_LINE_UNASSIGNED_CLASSIFICATION } from '../caspio/serviceLineTypes.js';

import { YardiFhirClient } from './yardiFhirClient.js';
import {
  extractYardiCommunityNameFromPatient,
  getYardiConditionTexts,
  getYardiCoverageNames,
  getYardiNormalizedCoverages,
  getYardiPatientAddress,
  getYardiPatientContacts,
  getYardiPatientPhone,
  mapYardiFhirBundleToDemographics,
} from './yardiFhirDemographics.js';
import { getYardiFhirPollCursorKey } from './yardiFhirPollConfig.js';
import type { SyncCursorStore } from './yardiFhirPollCursor.js';
import type {
  YardiFhirCaspioPushPlan,
  YardiFhirPatientBundle,
  YardiFhirPollTarget,
  YardiFhirPulledData,
  YardiFhirSyncPatientDetail,
  YardiFhirSyncSummary,
} from './yardiFhirTypes.js';

export async function runYardiFhirSyncForTarget(
  target: YardiFhirPollTarget,
  options: {
    cursorStore: SyncCursorStore;
    skipCaspio?: boolean;
    skipService?: boolean;
    includeDetails?: boolean;
    client?: YardiFhirClient;
  },
): Promise<YardiFhirSyncSummary> {
  const startedAt = new Date().toISOString();
  const summary: YardiFhirSyncSummary = {
    companyKey: target.companyKey,
    communityId: target.communityId,
    organizationId: target.organizationId,
    skipCaspio: options.skipCaspio === true,
    skipService: shouldSkipYardiServiceCaspio(options.skipService),
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
  summary.sinceDate = sinceDate;
  if (options.includeDetails) {
    summary.patientDetails = [];
  }

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
    const detail: YardiFhirSyncPatientDetail = {
      patientId,
      status: 'failed',
    };

    try {
      const bundle = await client.fetchPatientBundle(patientId);
      const residentBundle = buildCanonicalResidentBundle({
        companyId: company.id,
        target,
        bundle,
      });
      const yardiSummary = buildYardiPulledDataSummary(bundle, residentBundle.demographics);
      if (options.includeDetails) {
        detail.yardi = yardiSummary;
      }

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

      if (options.includeDetails) {
        if (shouldSkipCaspio) {
          detail.caspio = {
            skipped: true,
            skipReason: options.skipCaspio
              ? 'skipCaspio requested'
              : 'EHR shadow mode enabled for non-yardi source',
            tables: getCaspioTableNames(),
          };
        } else {
          try {
            const skipService = shouldSkipYardiServiceCaspio(options.skipService);
            const caspioPlan = await buildYardiFhirCaspioRecords(
              residentBundle,
              target.communityId,
              { skipService },
            );
            detail.caspio = {
              skipped: false,
              tables: caspioPlan.tables,
              patientRecord: caspioPlan.patientRecord,
              communityRecord: caspioPlan.communityRecord,
              serviceRecord: caspioPlan.serviceRecord,
              serviceSkipped: skipService,
            };
            await pushYardiFhirCaspioRecords({ ...caspioPlan, skipService });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            detail.caspio = detail.caspio ?? {
              skipped: false,
              tables: getCaspioTableNames(),
            };
            detail.caspio.pushError = message;
            throw error;
          }
        }
      } else if (!shouldSkipCaspio) {
        await pushYardiFhirBundleToCaspio(residentBundle, target.communityId, {
          skipService: options.skipService,
        });
      }

      detail.status = 'succeeded';
      summary.patientsSucceeded += 1;
    } catch (error) {
      summary.patientsFailed += 1;
      const message = formatSyncError(error);
      detail.error = message;
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
    } finally {
      if (options.includeDetails && summary.patientDetails) {
        summary.patientDetails.push(detail);
      }
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

function formatSyncError(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data as Record<string, unknown>;
    if (typeof data.Message === 'string' && data.Message.trim().length > 0) {
      return `Caspio: ${data.Message}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function extractYardiCommunityName(bundle: YardiFhirPatientBundle): string | undefined {
  const entries = bundle.encounterBundle?.entry ?? [];
  for (const entry of entries) {
    const encounter = entry?.resource;
    if (!encounter || typeof encounter !== 'object') continue;
    const serviceProvider = (encounter as Record<string, unknown>).serviceProvider as
      | { display?: string }
      | undefined;
    const display = serviceProvider?.display?.trim();
    if (display) return display;
  }
  return extractYardiCommunityNameFromPatient(bundle.patient);
}

export function resolvePatientCommunityName(
  enrichment: CommunityEnrichment,
  yardiCommunityName?: string,
): string | undefined {
  const enriched = enrichment.CommunityName?.trim();
  const yardi = yardiCommunityName?.trim();
  if (enriched && enriched.toLowerCase() !== 'unknown') {
    return enriched;
  }
  return yardi ?? enriched;
}

export function resolveEffectiveCuid(
  enrichment: CommunityEnrichment,
  communityId: number,
  roomNumber?: string | null,
): string {
  const fromEnrichment = enrichment.CUID?.trim();
  if (fromEnrichment) return fromEnrichment;
  const room = roomNumber?.trim();
  if (room) return `COMM-${communityId}-${room}`;
  return `COMM-${communityId}`;
}

export function shouldSkipYardiServiceCaspio(skipService?: boolean): boolean {
  return skipService !== false;
}

export function isSyntheticCommunityCuid(
  cuid: string,
  communityId: number,
  roomNumber?: string | null,
): boolean {
  return cuid === resolveEffectiveCuid({}, communityId, roomNumber);
}

function buildServiceUpsertFilters(
  serviceRecord: Record<string, unknown>,
): Array<{ field: string; value: string | number | boolean }> {
  const filters: Array<{ field: string; value: string | number | boolean }> = [];
  if (serviceRecord.CUID) {
    filters.push({ field: 'CUID', value: String(serviceRecord.CUID) });
  }
  if (serviceRecord.PatientNumber) {
    filters.push({ field: 'PatientNumber', value: String(serviceRecord.PatientNumber) });
  }
  if (serviceRecord.ServiceType) {
    filters.push({ field: 'ServiceType', value: String(serviceRecord.ServiceType) });
  }
  if (serviceRecord.StartDate) {
    filters.push({ field: 'StartDate', value: String(serviceRecord.StartDate) });
  }
  return filters;
}

function getCaspioTableNames(): YardiFhirCaspioPushPlan['tables'] {
  return {
    patient: env.CASPIO_TABLE_NAME,
    community: env.CASPIO_COMMUNITY_TABLE_NAME,
    service: env.CASPIO_SERVICE_TABLE_NAME,
  };
}

export function buildYardiPulledDataSummary(
  bundle: YardiFhirPatientBundle,
  demographics: CanonicalResidentBundle['demographics'],
): YardiFhirPulledData {
  return {
    patientId: bundle.patientId,
    externalResidentId: demographics.externalResidentId,
    firstName: demographics.firstName ?? null,
    lastName: demographics.lastName ?? null,
    dateOfBirth: demographics.dateOfBirth ?? null,
    status: demographics.status ?? null,
    roomNumber: demographics.roomNumber ?? null,
    bed: demographics.bed ?? null,
    productType: demographics.productType ?? null,
    onPrem: demographics.onPrem ?? null,
    onPremDate: demographics.onPremDate ?? null,
    offPrem: demographics.offPrem ?? null,
    offPremDate: demographics.offPremDate ?? null,
    coverage: getYardiCoverageNames(bundle),
    conditions: getYardiConditionTexts(bundle),
    encounterCount: bundle.encounterBundle.entry?.length ?? 0,
  };
}

export async function buildYardiFhirCaspioRecords(
  bundle: CanonicalResidentBundle,
  communityId: number,
  options?: { skipService?: boolean },
): Promise<{
  tables: YardiFhirCaspioPushPlan['tables'];
  patientRecord: Record<string, unknown>;
  communityRecord: Record<string, unknown>;
  serviceRecord?: Record<string, unknown>;
}> {
  const vendorPayload = bundle.vendorPayload as YardiFhirPatientBundle | undefined;
  if (!vendorPayload) {
    throw new Error('Missing Yardi FHIR vendor payload for Caspio push');
  }

  const communityName = extractYardiCommunityName(vendorPayload);
  const enrichment = await getCommunityEnrichment(
    communityId,
    bundle.demographics.roomNumber ?? undefined,
    communityName,
  );
  const cuid = resolveEffectiveCuid(enrichment, communityId, bundle.demographics.roomNumber);
  const { slot1, slot2 } = getYardiNormalizedCoverages(vendorPayload);
  const conditions = getYardiConditionTexts(vendorPayload);
  const resolvedCommunityName = resolvePatientCommunityName(enrichment, communityName);
  const patientAddress = getYardiPatientAddress(vendorPayload.patient);
  const contacts = getYardiPatientContacts(vendorPayload.patient);
  const contact1 = contacts[0];
  const contact2 = contacts[1];

  const patientRecord = {
    PatientNumber: bundle.demographics.externalResidentId,
    FirstName: bundle.demographics.firstName ?? undefined,
    LastName: bundle.demographics.lastName ?? undefined,
    PatientDOB: formatCaspioDate(bundle.demographics.dateOfBirth),
    RoomNumber: bundle.demographics.roomNumber ?? undefined,
    ApartmentNumber: bundle.demographics.roomNumber ?? undefined,
    PatientAddress: patientAddress.street,
    PatientAddressCity: patientAddress.city,
    PatientAddressState: patientAddress.state,
    PatientAddressZip: patientAddress.postalCode,
    PatientPhoneNumber: getYardiPatientPhone(vendorPayload.patient),
    PatientPrimaryInsurance: slot1?.name ?? undefined,
    PrimaryInsuranceNum: slot1?.number ?? undefined,
    GroupNumber1: slot1?.group ?? undefined,
    Insurance_Type: slot1?.type ?? undefined,
    Secondinsurance: slot2?.name ?? undefined,
    SecondInsuranceNum: slot2?.number ?? undefined,
    GroupNumber2: slot2?.group ?? undefined,
    Insurance_2_Type: slot2?.type ?? undefined,
    FamilyContact1Name: contact1?.name,
    FamilyContact1Relationship: contact1?.relationship,
    FamilyContact1Number: contact1?.phone,
    FamilyContact1Email: contact1?.email,
    FamilyContact1Address: contact1?.address,
    FamilyContact2Name: contact2?.name,
    FamilyContact2Relationship: contact2?.relationship,
    FamilyContact2Number: contact2?.phone,
    FamilyContact2Email: contact2?.email,
    FamilyContact2Address: contact2?.address,
    Diagnosis1: conditions[0] ?? undefined,
    Diagnosis2: conditions[1] ?? undefined,
    Move_in_Date: formatCaspioDate(bundle.demographics.onPremDate),
    On_Prem: bundle.demographics.onPrem ?? undefined,
    On_Prem_Date: formatCaspioDate(bundle.demographics.onPremDate),
    Off_Prem: bundle.demographics.offPrem ?? undefined,
    Off_Prem_Date: formatCaspioDate(bundle.demographics.offPremDate),
    CUID: cuid,
    CommunityName: resolvedCommunityName,
    PatientCommunity: resolvedCommunityName,
  };

  const communityRecord = {
    CommunityID: String(communityId),
    CUID: cuid,
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

  const serviceType =
    bundle.demographics.classification?.trim() || SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
  const skipService = shouldSkipYardiServiceCaspio(options?.skipService);
  const serviceRecord = skipService
    ? undefined
    : mapServiceRecord({
        patientNumber: patientRecord.PatientNumber!,
        cuid: patientRecord.CUID,
        serviceType,
        startDate: patientRecord.Move_in_Date,
        endDate: undefined,
        communityName: patientRecord.CommunityName,
        roomNumber: patientRecord.RoomNumber,
      });

  return {
    tables: getCaspioTableNames(),
    patientRecord,
    communityRecord,
    serviceRecord,
  };
}

export async function pushYardiFhirCaspioRecords(records: {
  tables: YardiFhirCaspioPushPlan['tables'];
  patientRecord: Record<string, unknown>;
  communityRecord: Record<string, unknown>;
  serviceRecord?: Record<string, unknown>;
  skipService?: boolean;
}): Promise<void> {
  const communityId = Number(records.communityRecord.CommunityID ?? NaN);
  const roomNumber =
    typeof records.communityRecord.RoomNumber === 'string'
      ? records.communityRecord.RoomNumber
      : undefined;
  const cuid = records.communityRecord.CUID ? String(records.communityRecord.CUID) : undefined;
  const shouldUpsertCommunity =
    Boolean(cuid) &&
    Number.isFinite(communityId) &&
    !isSyntheticCommunityCuid(cuid!, communityId, roomNumber);

  if (shouldUpsertCommunity && cuid) {
    try {
      await caspioRequestWithRetry(() =>
        upsertByFields(
          records.tables.community,
          [{ field: 'CUID', value: cuid }],
          records.communityRecord,
        ),
      );
    } catch (error) {
      if (!isCommunityCuidConflict(error)) {
        throw error;
      }
      logger.warn(
        {
          communityId: records.communityRecord.CommunityID,
          cuid,
          message: formatSyncError(error),
        },
        'yardi_fhir_caspio_community_upsert_skipped_cuid_conflict',
      );
    }
  }

  await caspioRequestWithRetry(() =>
    upsertPatientByPatientNumber(
      records.tables.patient,
      String(records.patientRecord.PatientNumber),
      records.patientRecord,
    ),
  );

  if (shouldSkipYardiServiceCaspio(records.skipService) || !records.serviceRecord) {
    return;
  }

  const { Service_ID: _serviceId, ...serviceRecordForWrite } = records.serviceRecord;
  const serviceFilters = buildServiceUpsertFilters(serviceRecordForWrite);
  if (serviceFilters.length === 0) {
    throw new Error('Cannot upsert service record without CUID and identifying fields');
  }

  await caspioRequestWithRetry(() =>
    upsertByFields(records.tables.service, serviceFilters, serviceRecordForWrite),
  );
}

export async function pushYardiFhirBundleToCaspio(
  bundle: CanonicalResidentBundle,
  communityId: number,
  options?: { skipService?: boolean },
): Promise<void> {
  const records = await buildYardiFhirCaspioRecords(bundle, communityId, options);
  await pushYardiFhirCaspioRecords({ ...records, skipService: options?.skipService });
}
