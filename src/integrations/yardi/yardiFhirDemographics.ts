import type { NormalizedInsurance } from '../caspio/insuranceNormalization.js';
import type { CanonicalResidentDemographics } from '../ehr/types.js';

import type { FhirBundle, FhirPatient, YardiFhirPatientBundle } from './yardiFhirTypes.js';

export type YardiNormalizedCoverage = {
  name: string;
  type: string | null;
  group: string | null;
  number: string | null;
};

type YardiCoverageBucket = 'medicare' | 'medicaid' | 'commercial';

type ParsedYardiCoverage = YardiNormalizedCoverage & {
  bucket: YardiCoverageBucket;
};

type CoverageClassEntry = {
  name?: string;
  value?: string;
  typeCode?: string;
};

export type YardiFhirContact = {
  name?: string;
  relationship?: string;
  phone?: string;
  email?: string;
  address?: string;
};

export type YardiFhirPatientAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

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

function looksLikeRoomNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^\d+[A-Za-z0-9-]*$/.test(trimmed);
}

function looksLikeBed(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 30) return false;
  return /^[A-Za-z0-9\s-]+$/.test(trimmed);
}

function parseLocationDisplay(display: string): {
  roomNumber?: string;
  bed?: string;
  room?: string;
} {
  const parts = display
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return {};
  }

  const roomNumber = parts[parts.length - 2];
  const bed = parts[parts.length - 1];
  if (!looksLikeRoomNumber(roomNumber)) {
    return {};
  }

  if (looksLikeBed(bed)) {
    return {
      roomNumber,
      bed,
      room: `${roomNumber} ${bed}`.trim(),
    };
  }

  return {
    roomNumber,
    room: roomNumber,
  };
}

function isOrgSiteDisplay(display: string): boolean {
  if (display.includes(',')) return false;
  return /^.+\([^)]+\)$/.test(display);
}

function collectResidentLocationDisplays(
  locations: Array<Record<string, unknown>>,
): string[] {
  const displays: string[] = [];

  for (const locationEntry of locations) {
    const location = locationEntry.location as { display?: string } | undefined;
    const display = location?.display?.trim();
    if (!display || isOrgSiteDisplay(display)) continue;
    displays.push(display);
  }

  return displays;
}

function parseResidentLocationDisplays(displays: string[]): {
  roomNumber?: string;
  bed?: string;
  room?: string;
} {
  if (displays.length === 0) {
    return {};
  }

  const combined = displays.join(', ');
  const parsed = parseLocationDisplay(combined);
  if (parsed.roomNumber) {
    return parsed;
  }

  if (displays.length === 1 && looksLikeRoomNumber(displays[0])) {
    return {
      roomNumber: displays[0],
      room: displays[0],
    };
  }

  return {};
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

  const residentDisplays = collectResidentLocationDisplays(locations);
  const parsedFromLocations = parseResidentLocationDisplays(residentDisplays);
  if (parsedFromLocations.roomNumber) {
    return {
      ...parsedFromLocations,
      productType,
      onPrem,
      offPrem,
    };
  }

  const textDiv = (encounter.text as { div?: string } | undefined)?.div;
  if (typeof textDiv === 'string') {
    const locationMatch = textDiv.match(/Location:<\/b>\s*([^<]+)/i);
    if (locationMatch?.[1]) {
      const parsed = parseLocationDisplay(locationMatch[1]);
      if (parsed.roomNumber) {
        return {
          ...parsed,
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

function getCodeableConceptText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { text?: string; coding?: Array<{ display?: string; code?: string }> };
  if (typeof record.text === 'string' && record.text.trim().length > 0) {
    return record.text.trim();
  }
  const coding = Array.isArray(record.coding) ? record.coding : [];
  for (const item of coding) {
    if (typeof item.display === 'string' && item.display.trim().length > 0) {
      return item.display.trim();
    }
  }
  return undefined;
}

function getFirstIdentifierValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const record = item as { value?: string };
    if (typeof record.value === 'string' && record.value.trim().length > 0) {
      return record.value.trim();
    }
  }
  return undefined;
}

function containsIgnoreCase(value: string | undefined, needle: string): boolean {
  return value ? value.toLowerCase().includes(needle.toLowerCase()) : false;
}

function getCoverageClassEntries(value: unknown): CoverageClassEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: CoverageClassEntry[] = [];
  for (const item of value) {
    const record = item as {
      name?: string;
      value?: string;
      type?: { coding?: Array<{ code?: string }> };
    };
    const classValue = typeof record.value === 'string' ? record.value.trim() : undefined;
    if (!classValue) continue;

    const typeCode = Array.isArray(record.type?.coding)
      ? record.type.coding.map((coding) => coding.code?.toLowerCase()).find(Boolean)
      : undefined;

    entries.push({
      name: typeof record.name === 'string' ? record.name.trim() : undefined,
      value: classValue,
      typeCode,
    });
  }

  return entries;
}

function getCoverageClassValues(
  value: unknown,
): { group?: string; plan?: string; memberId?: string; policyNumber?: string } {
  const result: { group?: string; plan?: string; memberId?: string; policyNumber?: string } = {};

  for (const entry of getCoverageClassEntries(value)) {
    if (!entry.value) continue;

    if (entry.typeCode === 'group' || entry.typeCode === 'rxgroup') {
      result.group = entry.value;
      continue;
    }

    if (containsIgnoreCase(entry.name, 'group number') || containsIgnoreCase(entry.name, 'group')) {
      result.group = entry.value;
      continue;
    }

    if (entry.typeCode === 'rxid') {
      result.memberId = entry.value;
      continue;
    }

    if (containsIgnoreCase(entry.name, 'policy') || containsIgnoreCase(entry.name, 'id number')) {
      result.policyNumber = entry.value;
      continue;
    }

    if (entry.typeCode === 'plan' || entry.typeCode === 'subplan') {
      result.plan = entry.value;
    }
  }

  return result;
}

function buildPatientDisplayName(patient: FhirPatient | null): string | undefined {
  const names = pickPreferredName(patient);
  const parts = [names.firstName, names.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function pickCoveragePayorName(
  resource: Record<string, unknown>,
  patientDisplayName?: string,
): string | undefined {
  const payors = Array.isArray(resource.payor) ? resource.payor : [];
  const normalizedPatientName = patientDisplayName?.trim().toLowerCase();

  for (const item of payors) {
    const payor = item as { display?: string; reference?: string };
    const display = payor.display?.trim();
    if (!display) continue;

    const reference = payor.reference?.trim() ?? '';
    if (reference.includes('/Patient/')) continue;
    if (normalizedPatientName && display.toLowerCase() === normalizedPatientName) continue;

    return display;
  }

  for (const item of payors) {
    const display = (item as { display?: string }).display?.trim();
    if (!display) continue;
    if (normalizedPatientName && display.toLowerCase() === normalizedPatientName) continue;
    return display;
  }

  return undefined;
}

function classifyCoverageBucket(
  resource: Record<string, unknown>,
  patientDisplayName?: string,
): YardiCoverageBucket {
  const classEntries = getCoverageClassEntries(resource.class);
  const classText = classEntries
    .map((entry) => `${entry.name ?? ''} ${entry.value ?? ''}`)
    .join(' ');
  const narrative =
    typeof (resource.text as { div?: string } | undefined)?.div === 'string'
      ? (resource.text as { div: string }).div
      : '';
  const payorName = pickCoveragePayorName(resource, patientDisplayName) ?? '';
  const haystack = `${classText} ${narrative} ${payorName}`.toLowerCase();

  if (haystack.includes('medicaid')) {
    return 'medicaid';
  }
  if (haystack.includes('medicare')) {
    return 'medicare';
  }
  return 'commercial';
}

function getSubscriberId(resource: Record<string, unknown>): string | undefined {
  return typeof resource.subscriberId === 'string' && resource.subscriberId.trim().length > 0
    ? resource.subscriberId.trim()
    : undefined;
}

function parseGovernmentCoverage(
  resource: Record<string, unknown>,
  bucket: 'medicare' | 'medicaid',
): ParsedYardiCoverage {
  const classEntries = getCoverageClassEntries(resource.class);
  const label = bucket === 'medicare' ? 'medicare' : 'medicaid';
  const namedClass =
    classEntries.find((entry) => containsIgnoreCase(entry.name, label)) ??
    classEntries.find((entry) => entry.typeCode === 'plan') ??
    classEntries[0];
  const classValues = getCoverageClassValues(resource.class);
  const payors = Array.isArray(resource.payor) ? resource.payor : [];
  const payorLabel = payors
    .map((item) => (item as { display?: string }).display?.trim())
    .find((display) => display && containsIgnoreCase(display, label));

  return {
    bucket,
    name:
      namedClass?.name ??
      payorLabel ??
      (bucket === 'medicare' ? 'Medicare' : 'Medicaid'),
    type: bucket === 'medicare' ? 'Medicare' : 'Medicaid',
    group: classValues.group ?? null,
    number:
      namedClass?.value ??
      classValues.policyNumber ??
      classValues.plan ??
      getSubscriberId(resource) ??
      getFirstIdentifierValue(resource.identifier) ??
      null,
  };
}

function parseCommercialCoverage(
  resource: Record<string, unknown>,
  patientDisplayName?: string,
): ParsedYardiCoverage | null {
  const name = pickCoveragePayorName(resource, patientDisplayName);
  if (!name) return null;

  const classValues = getCoverageClassValues(resource.class);
  const subscriberId = getSubscriberId(resource);

  return {
    bucket: 'commercial',
    name,
    type: getCodeableConceptText(resource.type) ?? null,
    group: classValues.group ?? null,
    number:
      classValues.policyNumber ??
      classValues.plan ??
      subscriberId ??
      getFirstIdentifierValue(resource.identifier) ??
      classValues.memberId ??
      null,
  };
}

function parseFhirCoverage(
  resource: Record<string, unknown>,
  patientDisplayName?: string,
): ParsedYardiCoverage | null {
  const bucket = classifyCoverageBucket(resource, patientDisplayName);
  if (bucket === 'medicare' || bucket === 'medicaid') {
    return parseGovernmentCoverage(resource, bucket);
  }
  return parseCommercialCoverage(resource, patientDisplayName);
}

function isMedicarePartD(coverage: ParsedYardiCoverage): boolean {
  return (
    containsIgnoreCase(coverage.name, 'part d') ||
    containsIgnoreCase(coverage.name, 'medicare d') ||
    containsIgnoreCase(coverage.name, 'prescription drug')
  );
}

function pickPrimaryMedicareCoverage(
  coverages: ParsedYardiCoverage[],
): ParsedYardiCoverage | null {
  const medicareCoverages = coverages.filter((coverage) => coverage.bucket === 'medicare');
  if (medicareCoverages.length === 0) return null;

  const abCoverage = medicareCoverages.find(
    (coverage) =>
      containsIgnoreCase(coverage.name, 'a/b') || containsIgnoreCase(coverage.name, 'medicare a'),
  );
  if (abCoverage) return abCoverage;

  const nonPartDCoverage = medicareCoverages.find((coverage) => !isMedicarePartD(coverage));
  return nonPartDCoverage ?? medicareCoverages[0] ?? null;
}

function pickPrimaryMedicaidCoverage(
  coverages: ParsedYardiCoverage[],
): ParsedYardiCoverage | null {
  return coverages.find((coverage) => coverage.bucket === 'medicaid') ?? null;
}

function toNormalizedInsurance(coverage: ParsedYardiCoverage): NormalizedInsurance {
  return {
    name: coverage.name,
    type: coverage.type,
    group: coverage.group,
    number: coverage.number,
    isMedicare:
      coverage.bucket === 'medicare' ||
      coverage.bucket === 'medicaid' ||
      containsIgnoreCase(coverage.name, 'medicare') ||
      containsIgnoreCase(coverage.name, 'medicaid'),
  };
}

export function assignYardiInsuranceSlots(coverages: ParsedYardiCoverage[]): {
  slot1: NormalizedInsurance | null;
  slot2: NormalizedInsurance | null;
} {
  const commercialCoverages = coverages.filter((coverage) => coverage.bucket === 'commercial');
  const medicarePrimary = pickPrimaryMedicareCoverage(coverages);
  if (medicarePrimary) {
    return {
      slot1: toNormalizedInsurance(medicarePrimary),
      slot2: commercialCoverages[0] ? toNormalizedInsurance(commercialCoverages[0]) : null,
    };
  }

  const medicaidPrimary = pickPrimaryMedicaidCoverage(coverages);
  if (medicaidPrimary) {
    return {
      slot1: toNormalizedInsurance(medicaidPrimary),
      slot2: commercialCoverages[0] ? toNormalizedInsurance(commercialCoverages[0]) : null,
    };
  }

  return {
    slot1: commercialCoverages[0] ? toNormalizedInsurance(commercialCoverages[0]) : null,
    slot2: commercialCoverages[1] ? toNormalizedInsurance(commercialCoverages[1]) : null,
  };
}

function getParsedCoverages(
  bundle: FhirBundle,
  patientDisplayName?: string,
): ParsedYardiCoverage[] {
  const coverages: ParsedYardiCoverage[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== 'Coverage') continue;
    const parsed = parseFhirCoverage(resource, patientDisplayName);
    if (parsed) {
      coverages.push(parsed);
    }
  }
  return coverages;
}

function getCoverageNames(bundle: FhirBundle, patientDisplayName?: string): string[] {
  const { slot1, slot2 } = assignYardiInsuranceSlots(
    getParsedCoverages(bundle, patientDisplayName),
  );
  return [slot1?.name, slot2?.name].filter((name): name is string => Boolean(name));
}

function getFhirTelecomPhone(telecom: unknown): string | undefined {
  if (!Array.isArray(telecom)) return undefined;
  const phoneEntries = telecom.filter((item) => {
    const record = item as { system?: string; value?: string };
    return record.system === 'phone' && typeof record.value === 'string' && record.value.trim().length > 0;
  }) as Array<{ use?: string; value?: string }>;

  for (const use of ['home', 'mobile', 'work']) {
    const match = phoneEntries.find((entry) => entry.use === use);
    if (match?.value) return match.value.trim();
  }

  return phoneEntries[0]?.value?.trim();
}

function getFhirTelecomEmail(telecom: unknown): string | undefined {
  if (!Array.isArray(telecom)) return undefined;
  for (const item of telecom) {
    const record = item as { system?: string; value?: string };
    if (record.system === 'email' && typeof record.value === 'string' && record.value.trim().length > 0) {
      return record.value.trim();
    }
  }
  return undefined;
}

function formatFhirAddress(address: unknown): string | undefined {
  if (!address || typeof address !== 'object') return undefined;
  const record = address as {
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
  };
  const parts: string[] = [];
  if (Array.isArray(record.line)) {
    for (const line of record.line) {
      if (typeof line === 'string' && line.trim().length > 0) {
        parts.push(line.trim());
      }
    }
  }

  const cityStateZip = [record.city, record.state, record.postalCode]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  if (cityStateZip.length > 0) {
    parts.push(cityStateZip.join(', '));
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
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
  return getCoverageNames(bundle.coverageBundle, buildPatientDisplayName(bundle.patient));
}

export function getYardiNormalizedCoverages(bundle: YardiFhirPatientBundle): {
  slot1: NormalizedInsurance | null;
  slot2: NormalizedInsurance | null;
} {
  return assignYardiInsuranceSlots(
    getParsedCoverages(bundle.coverageBundle, buildPatientDisplayName(bundle.patient)),
  );
}

export function getYardiPatientPhone(patient: FhirPatient | null): string | undefined {
  if (!patient) return undefined;
  return getFhirTelecomPhone(patient.telecom);
}

export function getYardiPatientAddress(patient: FhirPatient | null): YardiFhirPatientAddress {
  if (!patient || !Array.isArray(patient.address) || patient.address.length === 0) {
    return {};
  }

  const address = patient.address[0] as {
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
  };

  const street = Array.isArray(address.line)
    ? address.line
        .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
        .map((line) => line.trim())
        .join(', ')
    : undefined;

  return {
    street: street || undefined,
    city: typeof address.city === 'string' ? address.city.trim() : undefined,
    state: typeof address.state === 'string' ? address.state.trim() : undefined,
    postalCode:
      typeof address.postalCode === 'string' ? address.postalCode.trim() : undefined,
  };
}

export function getYardiPatientContacts(patient: FhirPatient | null): YardiFhirContact[] {
  if (!patient || !Array.isArray(patient.contact)) {
    return [];
  }

  const contacts: YardiFhirContact[] = [];
  for (const item of patient.contact) {
    if (!item || typeof item !== 'object') continue;
    const contact = item as Record<string, unknown>;
    const nameRecord = contact.name as { given?: string[]; family?: string } | undefined;
    const given = Array.isArray(nameRecord?.given)
      ? nameRecord.given.filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      : [];
    const family =
      typeof nameRecord?.family === 'string' && nameRecord.family.trim().length > 0
        ? nameRecord.family.trim()
        : undefined;
    const name = [...given, ...(family ? [family] : [])].join(' ').trim();

    const relationship = Array.isArray(contact.relationship)
      ? getCodeableConceptText(contact.relationship[0])
      : undefined;

    contacts.push({
      name: name || undefined,
      relationship,
      phone: getFhirTelecomPhone(contact.telecom),
      email: getFhirTelecomEmail(contact.telecom),
      address: formatFhirAddress(contact.address),
    });
  }

  return contacts.filter(
    (contact) =>
      contact.name || contact.relationship || contact.phone || contact.email || contact.address,
  );
}

export function extractYardiCommunityNameFromPatient(
  patient: FhirPatient | null,
): string | undefined {
  if (!patient || typeof patient.managingOrganization !== 'object' || patient.managingOrganization === null) {
    return undefined;
  }
  const display = (patient.managingOrganization as { display?: string }).display?.trim();
  return display || undefined;
}

export function getYardiConditionTexts(bundle: YardiFhirPatientBundle): string[] {
  return getConditionTexts(bundle.conditionBundle);
}
