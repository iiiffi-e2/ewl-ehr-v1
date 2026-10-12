import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getCommunityEnrichment } from '../caspio/caspioCommunityEnrichment.js';
import {
  isServiceRowOpen,
  listServiceRowsForPatient,
  updateRecordById,
  upsertByFields,
  type ServiceTableRecord,
} from '../caspio/caspioClient.js';
import { mapServiceRecord } from '../caspio/caspioMapper.js';
import {
  EYEWATCH_DETECT_SERVICE_TYPE,
  EYEWATCH_INTERVENE_SERVICE_TYPE,
} from '../caspio/serviceLineTypes.js';

import {
  extractYardiCommunityNameFromPatient,
  mapYardiFhirBundleToDemographics,
} from './yardiFhirDemographics.js';
import { YardiFhirClient } from './yardiFhirClient.js';
import type { FhirBundle, YardiFhirPatientBundle } from './yardiFhirTypes.js';

export type EyeWatchServiceType = 'Detect' | 'Intervene';

export type EyeWatchCarePlanReading = {
  serviceType: EyeWatchServiceType | null;
  monitoringWithoutLevel: boolean;
};

export type EyeWatchServiceAction = 'none' | 'open' | 'close' | 'replace';

export type YardiCarePlanServiceSyncResult = {
  patientId: string;
  roomNumber: string | null;
  cuid: string | null;
  serviceType: EyeWatchServiceType | null;
  monitoringWithoutLevel: boolean;
  action: EyeWatchServiceAction | 'skipped';
  skipReason?: string;
};

export type YardiCarePlanServiceCheckPatient = YardiCarePlanServiceSyncResult & {
  firstName: string | null;
  lastName: string | null;
  error?: string;
};

export type YardiCarePlanServiceCheckSummary = {
  communityId: number;
  organizationId: string;
  patientId?: string;
  patientsDiscovered: number;
  patientsProcessed: number;
  patientsFailed: number;
  opened: number;
  closed: number;
  replaced: number;
  unchanged: number;
  skipped: number;
  patients: YardiCarePlanServiceCheckPatient[];
};

const EYEWATCH_MONITORING_LABEL = 'eyewatch monitoring';

export function eyeWatchServiceTypeFromLabel(value: string | undefined): EyeWatchServiceType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('intervene')) return EYEWATCH_INTERVENE_SERVICE_TYPE;
  if (normalized.includes('detect')) return EYEWATCH_DETECT_SERVICE_TYPE;
  return null;
}

export function readEyeWatchFromCarePlanBundles(bundles: FhirBundle[]): EyeWatchCarePlanReading {
  let sawMonitoring = false;
  let sawDetect = false;
  let sawIntervene = false;

  for (const bundle of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource || resource.resourceType !== 'CarePlan') continue;
      if (typeof resource.status === 'string' && resource.status.toLowerCase() !== 'active') continue;

      const narrative = narrativeText(resource);
      if (narrative.includes(EYEWATCH_MONITORING_LABEL)) {
        sawMonitoring = true;
      }

      const activities = Array.isArray(resource.activity) ? resource.activity : [];
      for (const activity of activities) {
        const reading = readActivity(activity);
        if (reading.monitoring) sawMonitoring = true;
        if (reading.level === EYEWATCH_INTERVENE_SERVICE_TYPE) sawIntervene = true;
        if (reading.level === EYEWATCH_DETECT_SERVICE_TYPE) sawDetect = true;
      }
    }
  }

  const serviceType = sawIntervene
    ? EYEWATCH_INTERVENE_SERVICE_TYPE
    : sawDetect
      ? EYEWATCH_DETECT_SERVICE_TYPE
      : null;

  return {
    serviceType,
    monitoringWithoutLevel: sawMonitoring && serviceType === null,
  };
}

export function formatServiceBoundaryDate(date = new Date()): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}

export async function applyEyeWatchServiceChange(params: {
  reading: EyeWatchCarePlanReading;
  rows: Array<{ id: string; record: ServiceTableRecord }>;
  boundaryDate: string;
  closeRow: (id: string, endDate: string) => Promise<void>;
  openRow: (serviceType: EyeWatchServiceType) => Promise<void>;
}): Promise<EyeWatchServiceAction> {
  if (params.reading.monitoringWithoutLevel) {
    return 'none';
  }

  const openEyeWatchRows = params.rows.filter((row) => {
    return isServiceRowOpen(row.record.EndDate) && eyeWatchServiceTypeFromLabel(readRowServiceType(row.record));
  });
  const incoming = params.reading.serviceType;
  const alreadyOpen = incoming
    ? openEyeWatchRows.filter((row) => eyeWatchServiceTypeFromLabel(readRowServiceType(row.record)) === incoming)
    : [];
  const rowsToClose = incoming
    ? openEyeWatchRows.filter((row) => eyeWatchServiceTypeFromLabel(readRowServiceType(row.record)) !== incoming)
    : openEyeWatchRows;

  if (!incoming && rowsToClose.length === 0) {
    return 'none';
  }
  if (incoming && rowsToClose.length === 0 && alreadyOpen.length > 0) {
    return 'none';
  }

  for (const row of rowsToClose) {
    await params.closeRow(row.id, params.boundaryDate);
  }
  if (incoming && alreadyOpen.length === 0) {
    await params.openRow(incoming);
  }

  if (!incoming) return 'close';
  if (rowsToClose.length > 0 && alreadyOpen.length === 0) return 'replace';
  if (rowsToClose.length > 0) return 'close';
  return 'open';
}

export async function syncYardiCarePlanServiceForPatient(params: {
  client: Pick<YardiFhirClient, 'listActiveCarePlans'>;
  patientId: string;
  patientNumber: string;
  communityId: number;
  roomNumber?: string | null;
  communityName?: string;
  boundaryDate?: string;
}): Promise<YardiCarePlanServiceSyncResult> {
  const bundles = await params.client.listActiveCarePlans(params.patientId);
  const reading = readEyeWatchFromCarePlanBundles(bundles);
  const roomNumber = params.roomNumber?.trim() || null;
  const base = {
    patientId: params.patientId,
    roomNumber,
    serviceType: reading.serviceType,
    monitoringWithoutLevel: reading.monitoringWithoutLevel,
  };

  if (!roomNumber) {
    logger.warn(
      { patientId: params.patientId, communityId: params.communityId },
      'yardi_careplan_service_skipped_missing_room',
    );
    return { ...base, cuid: null, action: 'skipped', skipReason: 'Room number was not found on the Yardi patient' };
  }

  const enrichment = await getCommunityEnrichment(params.communityId, roomNumber, params.communityName);
  const cuid = enrichment.CUID?.trim();
  if (!cuid) {
    logger.warn(
      { patientId: params.patientId, communityId: params.communityId, roomNumber },
      'yardi_careplan_service_skipped_missing_cuid',
    );
    return {
      ...base,
      cuid: null,
      action: 'skipped',
      skipReason: 'No Caspio room row was found for this community and room',
    };
  }

  if (reading.monitoringWithoutLevel) {
    logger.warn(
      { patientId: params.patientId, communityId: params.communityId, cuid },
      'yardi_careplan_eyewatch_level_unknown',
    );
  }

  const rows = await listServiceRowsForPatient({
    patientNumber: params.patientNumber,
    cuid,
  });
  const boundaryDate = params.boundaryDate ?? formatServiceBoundaryDate();
  const communityName = enrichment.CommunityName ?? params.communityName;
  const action = await applyEyeWatchServiceChange({
    reading,
    rows,
    boundaryDate,
    closeRow: async (id, endDate) => {
      await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, id, { EndDate: endDate });
    },
    openRow: async (serviceType) => {
      const serviceRecord = mapServiceRecord({
        patientNumber: params.patientNumber,
        cuid,
        communityName,
        roomNumber,
        serviceType,
        startDate: boundaryDate,
      });
      const { Service_ID: _serviceId, ...serviceRecordForWrite } = serviceRecord;
      await upsertByFields(
        env.CASPIO_SERVICE_TABLE_NAME,
        [
          { field: 'CUID', value: cuid },
          { field: 'PatientNumber', value: params.patientNumber },
          { field: 'ServiceType', value: serviceType },
          { field: 'StartDate', value: boundaryDate },
        ],
        serviceRecordForWrite as Record<string, unknown>,
      );
    },
  });

  logger.info(
    {
      patientId: params.patientId,
      communityId: params.communityId,
      cuid,
      roomNumber,
      serviceType: reading.serviceType,
      action,
    },
    'yardi_careplan_service_sync_completed',
  );

  return {
    ...base,
    cuid,
    action,
  };
}

export async function runYardiCarePlanServiceCheck(params: {
  client: Pick<YardiFhirClient, 'listActivePatientIds' | 'fetchPatientBundle' | 'listActiveCarePlans'>;
  communityId: number;
  organizationId: string;
  patientId?: string;
}): Promise<YardiCarePlanServiceCheckSummary> {
  const requestedPatientId = params.patientId?.trim();
  const patientIds = requestedPatientId
    ? [requestedPatientId]
    : await params.client.listActivePatientIds(params.organizationId);

  const summary: YardiCarePlanServiceCheckSummary = {
    communityId: params.communityId,
    organizationId: params.organizationId,
    patientId: requestedPatientId || undefined,
    patientsDiscovered: patientIds.length,
    patientsProcessed: 0,
    patientsFailed: 0,
    opened: 0,
    closed: 0,
    replaced: 0,
    unchanged: 0,
    skipped: 0,
    patients: [],
  };

  for (const patientId of patientIds) {
    summary.patientsProcessed += 1;
    try {
      const bundle = await params.client.fetchPatientBundle(patientId);
      const demographics = mapYardiFhirBundleToDemographics(bundle);
      const result = await syncYardiCarePlanServiceForPatient({
        client: params.client,
        patientId,
        patientNumber: demographics.externalResidentId || patientId,
        communityId: params.communityId,
        roomNumber: demographics.roomNumber,
        communityName: communityNameFromBundle(bundle),
      });
      summary.patients.push({
        ...result,
        firstName: demographics.firstName ?? null,
        lastName: demographics.lastName ?? null,
      });
      if (result.action === 'open') summary.opened += 1;
      else if (result.action === 'close') summary.closed += 1;
      else if (result.action === 'replace') summary.replaced += 1;
      else if (result.action === 'skipped') summary.skipped += 1;
      else summary.unchanged += 1;
    } catch (error) {
      summary.patientsFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      summary.patients.push({
        patientId,
        firstName: null,
        lastName: null,
        roomNumber: null,
        cuid: null,
        serviceType: null,
        monitoringWithoutLevel: false,
        action: 'skipped',
        error: message,
      });
      logger.warn(
        { patientId, communityId: params.communityId, error: message },
        'yardi_careplan_service_check_patient_failed',
      );
    }
  }

  return summary;
}

function communityNameFromBundle(bundle: YardiFhirPatientBundle): string | undefined {
  for (const entry of bundle.encounterBundle?.entry ?? []) {
    const resource = entry.resource;
    if (!resource) continue;
    const serviceProvider = resource.serviceProvider as { display?: string } | undefined;
    const display = serviceProvider?.display?.trim();
    if (display) return display;
  }
  return extractYardiCommunityNameFromPatient(bundle.patient);
}

function readRowServiceType(record: ServiceTableRecord): string | undefined {
  const value = record.ServiceType ?? record.serviceType ?? record.Service_Type;
  return typeof value === 'string' ? value : undefined;
}

function narrativeText(resource: Record<string, unknown>): string {
  const text = resource.text;
  if (!text || typeof text !== 'object') return '';
  const div = (text as { div?: unknown }).div;
  return typeof div === 'string' ? div.toLowerCase() : '';
}

function readActivity(activity: unknown): { monitoring: boolean; level: EyeWatchServiceType | null } {
  if (!activity || typeof activity !== 'object') {
    return { monitoring: false, level: null };
  }
  const record = activity as Record<string, unknown>;
  const detail =
    record.detail && typeof record.detail === 'object'
      ? (record.detail as Record<string, unknown>)
      : {};
  const reasonTexts = [
    ...codeableTexts(record.reasonCode),
    ...codeableTexts(detail.reasonCode),
  ];
  const codeText = textOf(detail.code) ?? textOf(record.code) ?? '';
  const monitoring =
    reasonTexts.some((reason) => reason.toLowerCase() === EYEWATCH_MONITORING_LABEL) ||
    codeText.toLowerCase().includes('eyewatch');
  if (!monitoring) {
    return { monitoring: false, level: null };
  }
  return {
    monitoring: true,
    level: eyeWatchServiceTypeFromLabel(codeText),
  };
}

function codeableTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(textOf).filter((text): text is string => Boolean(text));
}

function textOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) return record.text.trim();
  return undefined;
}
