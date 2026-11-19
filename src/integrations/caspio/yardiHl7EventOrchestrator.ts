import { env } from '../../config/env.js';
import { recordEventIssue } from '../../domains/eventIssues.js';
import { recordUnmatchedCuid } from '../../domains/unmatchedCuid.js';
import type {
  CanonicalEventOrchestrationInput,
  CanonicalResidentBundle,
} from '../ehr/types.js';
import {
  buildYardiFhirCaspioRecords,
  extractYardiCommunityName,
  resolveEffectiveCuid,
} from '../yardi/yardiFhirSync.js';
import type { YardiFhirPatientBundle } from '../yardi/yardiFhirTypes.js';
import { mapYardiHl7PartyFields } from '../yardi/yardiHl7Parties.js';
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

function hl7Message(input: CanonicalEventOrchestrationInput): string | undefined {
  const vendorPayload = input.residentBundle?.vendorPayload as { hl7?: unknown } | undefined;
  if (typeof vendorPayload?.hl7 === 'string' && vendorPayload.hl7.startsWith('MSH|')) {
    return vendorPayload.hl7;
  }
  const notificationMessage = input.event.notificationData.Message;
  if (typeof notificationMessage === 'string' && notificationMessage.startsWith('MSH|')) {
    return notificationMessage;
  }
  return undefined;
}

function communityPatientAddress(enrichment: {
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
}): Record<string, string> {
  const record: Record<string, string> = {};
  if (enrichment.Address) record.PatientAddress = enrichment.Address;
  if (enrichment.City) record.PatientAddressCity = enrichment.City;
  if (enrichment.State) record.PatientAddressState = enrichment.State;
  if (enrichment.Zip) record.PatientAddressZip = enrichment.Zip;
  return record;
}

function withHl7PartyFields(
  record: Record<string, unknown>,
  input: CanonicalEventOrchestrationInput,
): Record<string, unknown> {
  return { ...record, ...mapYardiHl7PartyFields(hl7Message(input)) };
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

type RoomEnrichment = {
  CUID: string;
  synthetic: boolean;
  CommunityName?: string;
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  roomNumber?: string;
};

async function rememberUnmatched(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  enrichment: RoomEnrichment,
): Promise<void> {
  if (!enrichment.synthetic) return;
  const demographics = input.residentBundle!.demographics;
  await recordUnmatchedCuid({
    companyId: input.companyId,
    communityId,
    externalResidentId: String(demographics.externalResidentId ?? ''),
    roomNumber: enrichment.roomNumber,
    source: 'yardi-hl7',
    firstName: demographics.firstName,
    lastName: demographics.lastName,
    dateOfBirth: demographics.dateOfBirth,
    syntheticCuid: enrichment.CUID,
    eventType: input.event.eventType,
    eventMessageId: input.event.eventMessageId,
  });
}

async function findPatientOnCuid(patientNumber: string, cuid: string) {
  const match = await findRecordByFields(env.CASPIO_TABLE_NAME, [
    { field: 'PatientNumber', value: patientNumber },
    { field: 'CUID', value: cuid },
  ]);
  return {
    found: match.found,
    id: match.id,
    record: match.record as Record<string, unknown> | undefined,
  };
}

async function handleYardiMoveIn(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const bundle = input.residentBundle!;
  const demographics = bundle.demographics;
  const enrichment = await getRoomEnrichment(input, communityId);
  const vendorPayload = bundle.vendorPayload as YardiHl7VendorPayload | undefined;
  const fhirBundle = vendorPayload?.fhirBundle;
  const communityName = fhirBundle ? extractYardiCommunityName(fhirBundle) : undefined;

  const moveInDate = formatCaspioDateTime(input.event.eventMessageDate);
  let patientRecord: Record<string, unknown>;
  if (fhirBundle) {
    const records = await buildYardiFhirCaspioRecords(
      { ...bundle, vendorPayload: fhirBundle },
      communityId,
    );
    patientRecord = {
      ...withHl7PartyFields(
        {
          ...records.patientRecord,
          PatientNumber: demographics.externalResidentId,
          RoomNumber: enrichment.roomNumber,
          CUID: enrichment.CUID,
          Move_in_Date: moveInDate,
          Service_Start_Date: moveInDate,
          On_Prem: true,
        },
        input,
      ),
      ...communityPatientAddress(enrichment),
    };
  } else {
    patientRecord = {
      ...withHl7PartyFields(
        {
          PatientNumber: demographics.externalResidentId,
          FirstName: demographics.firstName ?? undefined,
          LastName: demographics.lastName ?? undefined,
          PatientDOB: formatCaspioDate(demographics.dateOfBirth),
          RoomNumber: enrichment.roomNumber,
          CUID: enrichment.CUID,
          CommunityName: enrichment.CommunityName ?? communityName,
          PatientCommunity: enrichment.CommunityName ?? communityName,
          Move_in_Date: moveInDate,
          Service_Start_Date: moveInDate,
          On_Prem: true,
        },
        input,
      ),
      ...communityPatientAddress(enrichment),
    };
  }

  const patientNumber = String(patientRecord.PatientNumber);
  await upsertByFields(
    env.CASPIO_TABLE_NAME,
    [
      { field: 'PatientNumber', value: patientNumber },
      { field: 'CUID', value: enrichment.CUID },
    ],
    patientRecord,
  );

  const serviceType =
    demographics.classification?.trim() || SERVICE_LINE_UNASSIGNED_CLASSIFICATION;
  const serviceRecord = mapServiceRecord({
    patientNumber,
    cuid: enrichment.CUID,
    roomNumber: enrichment.roomNumber,
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
      { field: 'CUID', value: enrichment.CUID },
      { field: 'PatientNumber', value: patientNumber },
      { field: 'ServiceType', value: serviceType },
      { field: 'StartDate', value: moveInDate },
    ],
    serviceRecord,
  );
  await rememberUnmatched(input, communityId, enrichment);
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

async function getRoomEnrichment(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<RoomEnrichment> {
  const bundle = input.residentBundle!;
  const roomNumber =
    bundle.demographics.roomNumber ??
    notificationString(input.event.notificationData, ['RoomNumber']);
  const vendorPayload = bundle.vendorPayload as YardiHl7VendorPayload | undefined;
  const fhirBundle = vendorPayload?.fhirBundle;
  const communityName = fhirBundle ? extractYardiCommunityName(fhirBundle) : undefined;
  const enrichment = await getCommunityEnrichment(communityId, roomNumber, communityName);
  const realCuid = enrichment.CUID?.trim();
  return {
    CUID: realCuid || resolveEffectiveCuid({}, communityId, roomNumber),
    synthetic: !realCuid,
    CommunityName: enrichment.CommunityName ?? communityName,
    Address: enrichment.Address,
    City: enrichment.City,
    State: enrichment.State,
    Zip: enrichment.Zip,
    roomNumber: roomNumber ?? undefined,
  };
}

async function buildYardiPatientPatch(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  enrichment: {
    CUID: string;
    CommunityName?: string;
    Address?: string;
    City?: string;
    State?: string;
    Zip?: string;
  },
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
      ...withHl7PartyFields(
        {
          ...patientRecord,
          PatientNumber: demographics.externalResidentId,
          RoomNumber: roomNumber,
          CUID: enrichment.CUID,
        },
        input,
      ),
      ...communityPatientAddress(enrichment),
    };
  }

  return {
    ...withHl7PartyFields(
      {
        PatientNumber: demographics.externalResidentId,
        FirstName: demographics.firstName ?? undefined,
        LastName: demographics.lastName ?? undefined,
        PatientDOB: formatCaspioDate(demographics.dateOfBirth),
        RoomNumber: roomNumber,
        CUID: enrichment.CUID,
        CommunityName: enrichment.CommunityName,
        PatientCommunity: enrichment.CommunityName,
      },
      input,
    ),
    ...communityPatientAddress(enrichment),
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
  const enrichment = await getRoomEnrichment(input, communityId);

  const patientNumber = String(
    input.residentBundle!.demographics.externalResidentId,
  );
  const restrictToSynthetic = enrichment.synthetic && !options.isTransfer;
  const existing = restrictToSynthetic
    ? await findPatientOnCuid(patientNumber, enrichment.CUID)
    : await findExistingPatient(patientNumber, enrichment.CUID);
  const trigger = normalizeYardiHl7Trigger(
    String(
      input.event.notificationData.TriggerEvent ??
        triggerFromYardiHl7EventType(input.event.eventType),
    ),
  );
  const eventDate = formatCaspioDateTime(input.event.eventMessageDate);
  const patientPatch = await buildYardiPatientPatch(input, communityId, enrichment);

  if (!existing.found || !existing.id) {
    if (restrictToSynthetic && !options.insertIfMissing) {
      const anyPatient = await findByPatientNumber(env.CASPIO_TABLE_NAME, patientNumber);
      if (!anyPatient.found) {
        await recordYardiIssue(
          input,
          'patient_not_found',
          `${trigger} event skipped because resident was not found in Caspio`,
          communityId,
        );
      }
      await rememberUnmatched(input, communityId, enrichment);
      return;
    }
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
    await rememberUnmatched(input, communityId, enrichment);
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
  await rememberUnmatched(input, communityId, enrichment);
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

async function requirePatientForRoomEvent(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  enrichment: RoomEnrichment,
  missingMessage: string,
): Promise<
  { patientNumber: string; existing: { id: string; record?: Record<string, unknown> } } | undefined
> {
  const patientNumber = String(input.residentBundle!.demographics.externalResidentId);
  if (!enrichment.synthetic) {
    return requireExistingPatient(input, communityId, enrichment.CUID, missingMessage);
  }

  const onSynthetic = await findPatientOnCuid(patientNumber, enrichment.CUID);
  if (onSynthetic.found && onSynthetic.id) {
    return {
      patientNumber,
      existing: {
        id: onSynthetic.id,
        record: onSynthetic.record as Record<string, unknown> | undefined,
      },
    };
  }

  const anyPatient = await findByPatientNumber(env.CASPIO_TABLE_NAME, patientNumber);
  if (!anyPatient.found) {
    await recordYardiIssue(input, 'patient_not_found', missingMessage, communityId);
  }
  await rememberUnmatched(input, communityId, enrichment);
  return undefined;
}

async function handleYardiMoveOut(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const enrichment = await getRoomEnrichment(input, communityId);
  const patient = await requirePatientForRoomEvent(
    input,
    communityId,
    enrichment,
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
  } else {
    await updateRecordById(env.CASPIO_SERVICE_TABLE_NAME, serviceRow.id, {
      EndDate: endDate,
    });
  }

  await rememberUnmatched(input, communityId, enrichment);
}

async function handleYardiLeaveStart(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const enrichment = await getRoomEnrichment(input, communityId);
  const patient = await requirePatientForRoomEvent(
    input,
    communityId,
    enrichment,
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
  await rememberUnmatched(input, communityId, enrichment);
}

async function handleYardiLeaveEnd(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<void> {
  const enrichment = await getRoomEnrichment(input, communityId);
  const patient = await requirePatientForRoomEvent(
    input,
    communityId,
    enrichment,
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
  await rememberUnmatched(input, communityId, enrichment);
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
