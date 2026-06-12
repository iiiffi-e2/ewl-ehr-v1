import type { CanonicalResidentDemographics } from '../ehr/types.js';

import type { FhirBundle, FhirPatient, YardiFhirPatientBundle } from './yardiFhirTypes.js';

function pickPreferredName(patient: FhirPatient | null): { firstName?: string; lastName?: string } {
  if (!patient) return {};
  const names = Array.isArray(patient.name) ? (patient.name as Array<Record<string, unknown>>) : [];
  const preferred = names[0];
  if (!preferred) return {};
  const given = Array.isArray(preferred.given) ? preferred.given : [];
  const firstName =
    given.length > 0 && typeof given[0] === 'string' ? (given[0] as string).trim() : undefined;
  const family =
    typeof preferred.family === 'string' && preferred.family.trim().length > 0
      ? preferred.family.trim()
      : undefined;
  return { firstName, lastName: family };
}

function parseEncounterLocation(encounter: Record<string, unknown> | undefined): {
  roomNumber?: string;
  bed?: string;
  room?: string;
  productType?: string;
  onPrem?: boolean;
  offPrem?: boolean;
} {
  if (!encounter) return {};

  const status = typeof encounter.status === 'string' ? encounter.status : undefined;
  const onPrem = status === 'in-progress' ? true : status === 'onleave' ? false : undefined;
  const offPrem = status === 'onleave' ? true : undefined;

  const typeTexts = Array.isArray(encounter.type)
    ? encounter.type
        .map((item) => {
          const record = item as Record<string, unknown>;
          return typeof record.text === 'string' ? record.text.trim() : undefined;
        })
        .filter(Boolean)
    : [];
  const productType = typeTexts[0];

  const locations = Array.isArray(encounter.location)
    ? (encounter.location as Array<Record<string, unknown>>)
    : [];
  for (const locationEntry of locations) {
    const location = locationEntry.location as { display?: string } | undefined;
    const display = location?.display?.trim();
    if (display) {
      const parts = display.split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const roomNumber = parts[parts.length - 2];
        const bed = parts[parts.length - 1];
        return {
          roomNumber,
          bed,
          room: `${roomNumber} ${bed}`.trim(),
          productType,
          onPrem,
          offPrem,
        };
      }
      return { roomNumber: display, room: display, productType, onPrem, offPrem };
    }
  }

  const textDiv = (encounter.text as { div?: string } | undefined)?.div;
  if (typeof textDiv === 'string') {
    const locationMatch = textDiv.match(/Location:<\/b>\s*([^<]+)/i);
    if (locationMatch?.[1]) {
      const parts = locationMatch[1].split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const roomNumber = parts[parts.length - 2];
        const bed = parts[parts.length - 1];
        return {
          roomNumber,
          bed,
          room: `${roomNumber} ${bed}`.trim(),
          productType,
          onPrem,
          offPrem,
        };
      }
    }
  }

  return { productType, onPrem, offPrem };
}

function getLatestEncounter(bundle: FhirBundle): Record<string, unknown> | undefined {
  const encounter = bundle.entry?.[0]?.resource;
  return encounter?.resourceType === 'Encounter' ? encounter : undefined;
}

function getCoverageNames(bundle: FhirBundle): string[] {
  const names: string[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== 'Coverage') continue;
    const payor = Array.isArray(resource.payor) ? resource.payor : [];
    for (const item of payor) {
      const display = (item as { display?: string }).display;
      if (typeof display === 'string' && display.trim().length > 0) {
        names.push(display.trim());
      }
    }
  }
  return names;
}

function getConditionTexts(bundle: FhirBundle): string[] {
  const values: string[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== 'Condition') continue;
    const code = resource.code as { text?: string } | undefined;
    if (typeof code?.text === 'string' && code.text.trim().length > 0) {
      values.push(code.text.trim());
    }
  }
  return values;
}

export function mapYardiFhirBundleToDemographics(
  bundle: YardiFhirPatientBundle,
  overrides: Partial<CanonicalResidentDemographics> = {},
): CanonicalResidentDemographics {
  const names = pickPreferredName(bundle.patient);
  const encounter = getLatestEncounter(bundle.encounterBundle);
  const location = parseEncounterLocation(encounter);
  const encounterPeriod = encounter?.period as { start?: string; end?: string } | undefined;

  return {
    externalResidentId: bundle.patientId,
    status:
      typeof bundle.patient?.active === 'boolean'
        ? bundle.patient.active
          ? 'active'
          : 'inactive'
        : null,
    firstName: names.firstName ?? null,
    lastName: names.lastName ?? null,
    dateOfBirth:
      typeof bundle.patient?.birthDate === 'string' && bundle.patient.birthDate.length > 0
        ? `${bundle.patient.birthDate}T00:00:00.000Z`
        : null,
    roomNumber: location.roomNumber ?? null,
    bed: location.bed ?? null,
    room: location.room ?? null,
    productType: location.productType ?? null,
    classification: location.productType ?? null,
    onPrem: location.onPrem ?? null,
    onPremDate:
      location.onPrem === true && typeof encounterPeriod?.start === 'string'
        ? `${encounterPeriod.start.slice(0, 10)}T00:00:00.000Z`
        : null,
    offPrem: location.offPrem ?? null,
    offPremDate:
      location.offPrem === true && typeof encounterPeriod?.start === 'string'
        ? `${encounterPeriod.start.slice(0, 10)}T00:00:00.000Z`
        : null,
    updatedAtUtc:
      typeof bundle.patient?.meta === 'object' &&
      bundle.patient.meta !== null &&
      typeof (bundle.patient.meta as { lastUpdated?: string }).lastUpdated === 'string'
        ? (bundle.patient.meta as { lastUpdated: string }).lastUpdated
        : null,
    ...overrides,
  };
}

export function getYardiCoverageNames(bundle: YardiFhirPatientBundle): string[] {
  return getCoverageNames(bundle.coverageBundle);
}

export function getYardiConditionTexts(bundle: YardiFhirPatientBundle): string[] {
  return getConditionTexts(bundle.conditionBundle);
}
