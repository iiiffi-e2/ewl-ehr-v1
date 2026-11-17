export type YardiHl7Contact = {
  name?: string;
  relationship?: string;
  phone?: string;
  address?: string;
};

export type YardiHl7Insurance = {
  name?: string;
  number?: string;
  group?: string;
  type?: string;
};

const INSURANCE_TYPE_LABELS: Record<string, string> = {
  HOSPCE: 'Hospice',
  INSUR: 'Insurance',
  MCDPND: 'Medicaid Pending',
  MDCD: 'Medicaid',
  MDCRA: 'Medicare A',
  MDCRB: 'Medicare B',
  PRIPAY: 'Private Pay',
  OTHER: 'Other',
};

function segmentsOf(hl7: string, name: string): string[] {
  return hl7
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${name}|`));
}

function field(segment: string, index: number): string | undefined {
  const value = segment.split('|')[index];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function component(value: string | undefined, index: number): string | undefined {
  if (!value) return undefined;
  const part = value.split('^')[index];
  if (!part) return undefined;
  const trimmed = part.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstRepetition(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const part = value
    .split('~')
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return part;
}

function formatContactAddress(addressField: string | undefined): string | undefined {
  const stateZip = [component(addressField, 3), component(addressField, 4)].filter(Boolean).join(' ');
  return joinAddress([
    component(addressField, 0),
    component(addressField, 1),
    component(addressField, 2),
    stateZip || undefined,
  ]);
}

function joinAddress(parts: Array<string | undefined>): string | undefined {
  const joined = parts.filter((part): part is string => Boolean(part)).join(', ');
  return joined.length > 0 ? joined : undefined;
}

function contactName(nameField: string | undefined): string | undefined {
  const last = component(nameField, 0);
  const first = component(nameField, 1);
  const middle = component(nameField, 2);
  const name = [first, middle, last].filter(Boolean).join(' ');
  return name.length > 0 ? name : undefined;
}

function parseContact(segment: string): YardiHl7Contact | undefined {
  const relationshipField = field(segment, 3);
  const contact: YardiHl7Contact = {
    name: contactName(field(segment, 2)),
    relationship: component(relationshipField, 1) ?? component(relationshipField, 0),
    phone: field(segment, 5) ?? firstRepetition(field(segment, 6)),
    address: formatContactAddress(field(segment, 4)),
  };
  if (!contact.name && !contact.relationship && !contact.phone && !contact.address) {
    return undefined;
  }
  return contact;
}

function insuranceType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return INSURANCE_TYPE_LABELS[value.toUpperCase()] ?? value;
}

function parseDiagnosis(segment: string): string | undefined {
  const coded = field(segment, 3);
  const code = component(coded, 0);
  const name = component(coded, 1);
  if (code && name) return `${code} ${name}`;
  return name ?? code;
}

function parseInsurance(segment: string): YardiHl7Insurance | undefined {
  const planName = component(field(segment, 2), 1) ?? component(field(segment, 2), 0);
  const companyName = field(segment, 4);
  const insurance: YardiHl7Insurance = {
    name: companyName ?? planName,
    group: field(segment, 8),
    type: insuranceType(field(segment, 15)),
    number: field(segment, 36),
  };
  if (!insurance.name && !insurance.number && !insurance.group && !insurance.type) {
    return undefined;
  }
  return insurance;
}

function setId(segment: string): number {
  const raw = Number(field(segment, 1));
  return Number.isFinite(raw) ? raw : Number.MAX_SAFE_INTEGER;
}

export function parseYardiHl7Contacts(hl7: string): YardiHl7Contact[] {
  return segmentsOf(hl7, 'NK1')
    .slice()
    .sort((left, right) => setId(left) - setId(right))
    .map(parseContact)
    .filter((contact): contact is YardiHl7Contact => contact !== undefined)
    .slice(0, 2);
}

export function parseYardiHl7Diagnoses(hl7: string): string[] {
  return segmentsOf(hl7, 'DG1')
    .slice()
    .sort((left, right) => setId(left) - setId(right))
    .map(parseDiagnosis)
    .filter((diagnosis): diagnosis is string => diagnosis !== undefined);
}

export function parseYardiHl7Insurances(hl7: string): YardiHl7Insurance[] {
  return segmentsOf(hl7, 'IN1')
    .slice()
    .sort((left, right) => setId(left) - setId(right))
    .map(parseInsurance)
    .filter((insurance): insurance is YardiHl7Insurance => insurance !== undefined)
    .slice(0, 2);
}

function assignContact(
  record: Record<string, string>,
  contact: YardiHl7Contact | undefined,
  slot: 1 | 2,
): void {
  if (!contact) return;
  if (contact.name) record[`FamilyContact${slot}Name`] = contact.name;
  if (contact.relationship) record[`FamilyContact${slot}Relationship`] = contact.relationship;
  if (contact.phone) record[`FamilyContact${slot}Number`] = contact.phone;
  if (contact.address) record[`FamilyContact${slot}Address`] = contact.address;
}

function assignInsurance(
  record: Record<string, string>,
  insurance: YardiHl7Insurance | undefined,
  slot: 1 | 2,
): void {
  if (!insurance) return;
  if (slot === 1) {
    if (insurance.name) record.PatientPrimaryInsurance = insurance.name;
    if (insurance.number) record.PrimaryInsuranceNum = insurance.number;
    if (insurance.group) record.GroupNumber1 = insurance.group;
    if (insurance.type) record.Insurance_Type = insurance.type;
    return;
  }
  if (insurance.name) record.Secondinsurance = insurance.name;
  if (insurance.number) record.SecondInsuranceNum = insurance.number;
  if (insurance.group) record.GroupNumber2 = insurance.group;
  if (insurance.type) record.Insurance_2_Type = insurance.type;
}

export function mapYardiHl7PartyFields(hl7: string | undefined): Record<string, string> {
  if (!hl7) return {};
  const record: Record<string, string> = {};
  const contacts = parseYardiHl7Contacts(hl7);
  const insurances = parseYardiHl7Insurances(hl7);
  assignContact(record, contacts[0], 1);
  assignContact(record, contacts[1], 2);
  assignInsurance(record, insurances[0], 1);
  assignInsurance(record, insurances[1], 2);
  const diagnoses = parseYardiHl7Diagnoses(hl7);
  if (diagnoses.length > 0) {
    record.Diagnosis1 = diagnoses.join('; ');
  }
  return record;
}
