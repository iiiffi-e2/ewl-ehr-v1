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

import {
  findActiveOrLatestServiceRow,
  findByPatientNumber,
  findOpenOffPremEpisode,
  findRecordByFields,
  updateRecordById,
  upsertByFields,
  upsertOffPremEpisodeByEpisodeId,
} from './caspioClient.js';
import { getCommunityEnrichment } from './caspioCommunityEnrichment.js';
import {
  mapOffPremEndPatch,
  mapOffPremStartEpisode,
  mapServiceRecord,
} from './caspioMapper.js';
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
  const communityName = fhirBundle ? extractYardiCommunityName(fhirBundle) : undefined;
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

function cuidFromRecord(record?: Record<string, unknown>): string | undefined {
  const value = record?.CUID;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

async function findExistingPatient(
  patientNumber: string,
  cuid: string,
): Promise<{ found: boolean; id?: string; record?: Record<string, unknown> }> {
  const match = await findRecordByFields(env.CASPIO_TABLE_NAME, [
    { field: 'PatientNumber', value: patientNumber },
    { field: 'CUID', value: cuid },
  ]);
  if (match.found) {
    return {
      found: true,
      id: match.id,
      record: match.record as Record<string, unknown> | undefined,
    };
  }

  const fallback = await findByPatientNumber(env.CASPIO_TABLE_NAME, patientNumber);
  return {
    found: fallback.found,
    id: fallback.id,
    record: fallback.raw as Record<string, unknown> | undefined,
  };
}

async function getRequiredEnrichment(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<{ CUID: string; CommunityName?: string } | undefined> {
  const bundle = input.residentBundle!;
  const roomNumber =
    bundle.demographics.roomNumber ??
    notificationString(input.event.notificationData, ['RoomNumber']);
  const vendorPayload = bundle.vendorPayload as YardiHl7VendorPayload | undefined;
  const fhirBundle = vendorPayload?.fhirBundle;
  const communityName = fhirBundle ? extractYardiCommunityName(fhirBundle) : undefined;
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
    return undefined;
  }

  return {
    CUID: cuid,
    CommunityName: enrichment.CommunityName ?? communityName,
  };
}

async function buildYardiPatientPatch(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  enrichment: { CUID: string; CommunityName?: string },
): Promise<Record<string, unknown>> {
  const bundle = input.residentBundle!;
  const demographics = bundle.demographics;
  const roomNumber =
    demographics.roomNumber ??
    notificationString(input.event.notificationData, ['RoomNumber']);
  const vendorPayload = bundle.vendorPayload as YardiHl7VendorPayload | undefined;
  const fhirBundle = vendorPayload?.fhirBundle;

  if (fhirBundle) {
    const records = await buildYardiFhirCaspioRecords(
      { ...bundle, vendorPayload: fhirBundle },
      communityId,
    );
    const patientRecord = { ...records.patientRecord };
    delete patientRecord.Move_in_Date;
    delete patientRecord.On_Prem;
    delete patientRecord.On_Prem_Date;
    delete patientRecord.Off_Prem;
    delete patientRecord.Off_Prem_Date;
    return {
      ...patientRecord,
      PatientNumber: demographics.externalResidentId,
      RoomNumber: roomNumber,
      CUID: enrichment.CUID,
    };
  }

  return {
    PatientNumber: demographics.externalResidentId,
    FirstName: demographics.firstName ?? undefined,
    LastName: demographics.lastName ?? undefined,
    PatientDOB: formatCaspioDate(demographics.dateOfBirth),
    RoomNumber: roomNumber,
    CUID: enrichment.CUID,
    CommunityName: enrichment.CommunityName,
    PatientCommunity: enrichment.CommunityName,
  };
}

async function openYardiService(
  input: CanonicalEventOrchestrationInput,
  enrichment: { CUID: string; CommunityName?: string },
  startDate: string,
): Promise<void> {
  const demographics = input.residentBundle!.demographics;
  const patientNumber = String(demographics.externalResidentId);
  const serviceType =
    demographics.classification?.trim() || SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
  const serviceRecord = mapServiceRecord({
    patientNumber,
    cuid: enrichment.CUID,
    roomNumber: demographics.roomNumber ?? undefined,
    serviceType,
    startDate,
    communityName: enrichment.CommunityName,
  });
  await upsertByFields(
    env.CASPIO_SERVICE_TABLE_NAME,
    [
      { field: 'CUID', value: enrichment.CUID },
      { field: 'PatientNumber', value: patientNumber },
      { field: 'ServiceType', value: serviceType },
      { field: 'StartDate', value: startDate },
    ],
    serviceRecord,
  );
}

async function handleYardiUpdate(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  options: { insertIfMissing: boolean; isTransfer: boolean },
): Promise<void> {
  const enrichment = await getRequiredEnrichment(input, communityId);
  if (!enrichment) return;

  const patientNumber = String(
    input.residentBundle!.demographics.externalResidentId,
  );
  const existing = await findExistingPatient(patientNumber, enrichment.CUID);
  const trigger = normalizeYardiHl7Trigger(
    String(
      input.event.notificationData.TriggerEvent ??
        triggerFromYardiHl7EventType(input.event.eventType),
    ),
  );
  const eventDate = formatCaspioDateTime(input.event.eventMessageDate);
  const patientPatch = await buildYardiPatientPatch(input, communityId, enrichment);

  if (!existing.found || !existing.id) {
    if (!options.insertIfMissing) {
      await recordYardiIssue(
        input,
        'patient_not_found',
        `${trigger} event skipped because resident was not found in Caspio`,
        communityId,
      );
      return;
    }

    const patientRecord = {
      ...patientPatch,
      Move_in_Date: eventDate,
      Service_Start_Date: eventDate,
      On_Prem: true,
    };
    await upsertByFields(
      env.CASPIO_TABLE_NAME,
      [
        { field: 'PatientNumber', value: patientNumber },
        { field: 'CUID', value: enrichment.CUID },
      ],
      patientRecord,
    );
    await openYardiService(input, enrichment, eventDate);
    return;
  }

  if (options.isTransfer) {
    const previousCuidFromPatient = cuidFromRecord(existing.record);
    const lookupPreviousCuid =
      previousCuidFromPatient && previousCuidFromPatient !== enrichment.CUID
        ? previousCuidFromPatient
        : undefined;
    const serviceRow = await findActiveOrLatestServiceRow(
      lookupPreviousCuid
        ? { patientNumber, cuid: lookupPreviousCuid }
        : { patientNumber },
    );
    const serviceCuid = cuidFromRecord(serviceRow.record as Record<string, unknown> | undefined);
    if (serviceRow.found && serviceRow.id && serviceCuid && serviceCuid !== enrichment.CUID) {
      await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, serviceRow.id, {
        EndDate: eventDate,
      });
      await openYardiService(input, enrichment, eventDate);
    } else if (lookupPreviousCuid && (!serviceRow.found || !serviceRow.id)) {
      await recordYardiIssue(
        input,
        'service_not_found',
        'Transfer completed but no previous service row was found to close',
        communityId,
      );
      await openYardiService(input, enrichment, eventDate);
    }
  }

  await updateRecordById(env.CASPIO_TABLE_NAME, existing.id, patientPatch);
}

async function requireExistingPatient(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  cuid: string,
  missingMessage: string,
): Promise<
  { patientNumber: string; existing: { id: string; record?: Record<string, unknown> } } | undefined
> {
  const patientNumber = String(input.residentBundle!.demographics.externalResidentId);
  const existing = await findExistingPatient(patientNumber, cuid);
  if (!existing.found || !existing.id) {
    await recordYardiIssue(
      input,
      'patient_not_found',
      missingMessage,
      communityId,
    );
    return undefined;
  }

  return {
    patientNumber,
    existing: { id: existing.id, record: existing.record },
  };
}

async function handleYardiMoveOut(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const enrichment = await getRequiredEnrichment(input, communityId);
  if (!enrichment) return;

  const patient = await requireExistingPatient(
    input,
    communityId,
    enrichment.CUID,
    'Move-out event skipped because resident was not found in Caspio',
  );
  if (!patient) return;

  const endDate = formatCaspioDateTime(input.event.eventMessageDate);
  await updateRecordById(env.CASPIO_TABLE_NAME, patient.existing.id, {
    Move_Out_Date: endDate,
    Service_End_Date: endDate,
    On_Prem: false,
  });

  const serviceRow = await findActiveOrLatestServiceRow({
    patientNumber: patient.patientNumber,
    cuid: enrichment.CUID,
  });
  if (!serviceRow.found || !serviceRow.id) {
    await recordYardiIssue(
      input,
      'service_not_found',
      'Move-out completed but no service row was found to close',
      communityId,
    );
    return;
  }

  await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, serviceRow.id, {
    EndDate: endDate,
  });
}

async function handleYardiLeaveStart(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const enrichment = await getRequiredEnrichment(input, communityId);
  if (!enrichment) return;

  const patient = await requireExistingPatient(
    input,
    communityId,
    enrichment.CUID,
    'Leave-start event skipped because resident was not found in Caspio',
  );
  if (!patient) return;

  const offPremStart = formatCaspioDateTime(input.event.eventMessageDate);
  await updateRecordById(env.CASPIO_TABLE_NAME, patient.existing.id, {
    Off_Prem: true,
    On_Prem: false,
    Off_Prem_Date: offPremStart,
  });
  await upsertOffPremEpisodeByEpisodeId(
    mapOffPremStartEpisode({
      patientNumber: patient.patientNumber,
      cuid: enrichment.CUID,
      communityName: enrichment.CommunityName,
      offPremStart,
    }),
  );
}

async function handleYardiLeaveEnd(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const enrichment = await getRequiredEnrichment(input, communityId);
  if (!enrichment) return;

  const patient = await requireExistingPatient(
    input,
    communityId,
    enrichment.CUID,
    'Leave-end event skipped because resident was not found in Caspio',
  );
  if (!patient) return;

  const offPremEnd = formatCaspioDateTime(input.event.eventMessageDate);
  const openEpisode = await findOpenOffPremEpisode({
    patientNumber: patient.patientNumber,
    cuid: enrichment.CUID,
  });
  const offPremStart = openEpisode.record?.OffPremStart;
  if (openEpisode.found && openEpisode.id && typeof offPremStart === 'string') {
    await updateRecordById(
      env.CASPIO_OFF_PREM_HISTORY_TABLE_NAME,
      openEpisode.id,
      mapOffPremEndPatch({ offPremStart, offPremEnd }),
    );
  } else {
    await recordYardiIssue(
      input,
      'open_off_prem_episode_not_found',
      'Leave-end event found no open off-prem episode to close',
      communityId,
    );
  }

  await updateRecordById(env.CASPIO_TABLE_NAME, patient.existing.id, {
    Off_Prem: false,
    On_Prem: true,
  });
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
    case 'A02':
      await handleYardiUpdate(input, communityId, {
        insertIfMissing: false,
        isTransfer: true,
      });
      return;
    case 'A03':
      await handleYardiMoveOut(input, communityId);
      return;
    case 'A05':
      await handleYardiUpdate(input, communityId, {
        insertIfMissing: true,
        isTransfer: false,
      });
      return;
    case 'A08':
    case 'A60':
      await handleYardiUpdate(input, communityId, {
        insertIfMissing: false,
        isTransfer: false,
      });
      return;
    case 'A21':
      await handleYardiLeaveStart(input, communityId);
      return;
    case 'A22':
      await handleYardiLeaveEnd(input, communityId);
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
