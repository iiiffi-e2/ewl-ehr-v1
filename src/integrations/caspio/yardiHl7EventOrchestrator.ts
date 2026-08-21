import { env } from '../../config/env.js';
import { recordEventIssue } from '../../domains/eventIssues.js';
import type {
  CanonicalEventOrchestrationInput,
  CanonicalResidentBundle,
} from '../ehr/types.js';
import {
  buildYardiFhirCaspioRecords,
  extractYardiCommunityName,
} from '../yardi/yardiFhirSync.js';
import type { YardiFhirPatientBundle } from '../yardi/yardiFhirTypes.js';
import {
  normalizeYardiHl7Trigger,
  triggerFromYardiHl7EventType,
} from '../yardi/yardiHl7Triggers.js';

import { upsertByFields } from './caspioClient.js';
import { getCommunityEnrichment } from './caspioCommunityEnrichment.js';
import { mapServiceRecord } from './caspioMapper.js';
import { SERVICE_LINE_UNASSIGNED_CLASSIFICATION } from './serviceLineTypes.js';

type YardiHl7VendorPayload = {
  hl7?: string;
  parsed?: unknown;
  fhirBundle?: YardiFhirPatientBundle;
  fhirOverlayError?: unknown;
};

function formatCaspioDateTime(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}

function formatCaspioDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${parsed.getUTCFullYear()}`;
}

function numericResidentId(bundle: CanonicalResidentBundle): number | undefined {
  const residentId = Number(bundle.residentId);
  return Number.isFinite(residentId) ? residentId : undefined;
}

function notificationString(
  notificationData: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = notificationData[key];
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}

async function recordYardiIssue(
  input: CanonicalEventOrchestrationInput,
  stage: string,
  message: string,
  communityId?: number | null,
): Promise<void> {
  await recordEventIssue({
    companyId: input.companyId,
    source: 'yardi-hl7',
    eventType: input.event.eventType,
    eventMessageId: input.event.eventMessageId,
    residentId: input.residentBundle
      ? numericResidentId(input.residentBundle)
      : undefined,
    communityId,
    stage,
    severity: 'warning',
    message,
    retryable: false,
  });
}

async function handleYardiMoveIn(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const bundle = input.residentBundle!;
  const demographics = bundle.demographics;
  const roomNumber =
    demographics.roomNumber ??
    notificationString(input.event.notificationData, ['RoomNumber']);
  const vendorPayload = bundle.vendorPayload as YardiHl7VendorPayload | undefined;
  const fhirBundle = vendorPayload?.fhirBundle;
  const communityName =
    (fhirBundle ? extractYardiCommunityName(fhirBundle) : undefined) ??
    notificationString(input.event.notificationData, [
      'CommunityName',
      'SendingFacility',
      'Pv1Facility',
    ]);
  const enrichment = await getCommunityEnrichment(
    communityId,
    roomNumber,
    communityName,
  );
  const cuid = enrichment.CUID?.trim();

  if (!cuid) {
    await recordYardiIssue(
      input,
      'missing_cuid',
      `No Caspio CUID found for Yardi HL7 community '${communityId}' and room '${roomNumber ?? ''}'`,
      communityId,
    );
    return;
  }

  const moveInDate = formatCaspioDateTime(input.event.eventMessageDate);
  let patientRecord: Record<string, unknown>;
  if (fhirBundle) {
    const records = await buildYardiFhirCaspioRecords(
      { ...bundle, vendorPayload: fhirBundle },
      communityId,
    );
    patientRecord = {
      ...records.patientRecord,
      PatientNumber: demographics.externalResidentId,
      RoomNumber: roomNumber,
      CUID: cuid,
      Move_in_Date: moveInDate,
      Service_Start_Date: moveInDate,
      On_Prem: true,
    };
  } else {
    patientRecord = {
      PatientNumber: demographics.externalResidentId,
      FirstName: demographics.firstName ?? undefined,
      LastName: demographics.lastName ?? undefined,
      PatientDOB: formatCaspioDate(demographics.dateOfBirth),
      RoomNumber: roomNumber,
      CUID: cuid,
      CommunityName: enrichment.CommunityName ?? communityName,
      PatientCommunity: enrichment.CommunityName ?? communityName,
      Move_in_Date: moveInDate,
      Service_Start_Date: moveInDate,
      On_Prem: true,
    };
  }

  const patientNumber = String(patientRecord.PatientNumber);
  await upsertByFields(
    env.CASPIO_TABLE_NAME,
    [
      { field: 'PatientNumber', value: patientNumber },
      { field: 'CUID', value: cuid },
    ],
    patientRecord,
  );

  const serviceType =
    demographics.classification?.trim() || SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
  const serviceRecord = mapServiceRecord({
    patientNumber,
    cuid,
    roomNumber: roomNumber ?? undefined,
    serviceType,
    startDate: moveInDate,
    communityName:
      typeof patientRecord.CommunityName === 'string'
        ? patientRecord.CommunityName
        : enrichment.CommunityName ?? communityName,
  });
  await upsertByFields(
    env.CASPIO_SERVICE_TABLE_NAME,
    [
      { field: 'CUID', value: cuid },
      { field: 'PatientNumber', value: patientNumber },
      { field: 'ServiceType', value: serviceType },
      { field: 'StartDate', value: moveInDate },
    ],
    serviceRecord,
  );
}

export async function handleYardiHl7Event(
  input: CanonicalEventOrchestrationInput,
): Promise<void> {
  const bundle = input.residentBundle;
  if (!bundle) throw new Error('Yardi HL7 event orchestration requires residentBundle');

  const communityId = bundle.communityId ?? input.event.communityId;
  if (communityId === null || communityId === undefined) {
    await recordYardiIssue(
      input,
      'missing_community_id',
      'Yardi HL7 event orchestration requires communityId',
      communityId,
    );
    return;
  }

  const trigger = normalizeYardiHl7Trigger(
    String(
      input.event.notificationData.TriggerEvent ??
        triggerFromYardiHl7EventType(input.event.eventType),
    ),
  );
  switch (trigger) {
    case 'A01':
      await handleYardiMoveIn(input, communityId);
      return;
    default:
      await recordYardiIssue(
        input,
        'unsupported_trigger',
        `Unsupported Yardi HL7 trigger '${trigger}'`,
        communityId,
      );
      return;
  }
}
