export type NormalizedInsurance = {
  name: string | null;
  type: string | null;
  group: string | null;
  number: string | null;
  isMedicare: boolean;
};

type InsuranceRecord = Record<string, unknown>;

function getStringValue(obj: InsuranceRecord | undefined | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function containsIgnoreCase(value: string | null, needle: string): boolean {
  return value ? value.toLowerCase().includes(needle.toLowerCase()) : false;
}

function mapInsurance(insurance: InsuranceRecord): NormalizedInsurance {
  const name = getStringValue(insurance, [
    'payerName',
    'PayerName',
    'insuranceName',
    'InsuranceName',
    'name',
    'Name',
  ]);
  const type = getStringValue(insurance, [
    'type',
    'Type',
    'insuranceType',
    'InsuranceType',
    'planType',
    'PlanType',
  ]);
  const group = getStringValue(insurance, [
    'groupNumber',
    'GroupNumber',
    'groupNo',
    'GroupNo',
    'group',
    'Group',
  ]);
  const number = getStringValue(insurance, [
    'policyNumber',
    'PolicyNumber',
    'memberId',
    'MemberId',
    'insuranceNumber',
    'InsuranceNumber',
  ]);
  const isMedicare = containsIgnoreCase(name, 'medicare') || containsIgnoreCase(type, 'medicare');

  return {
    name,
    type,
    group,
    number,
    isMedicare,
  };
}

export function normalizeMedicalInsurances(insurances: any[]): {
  slot1: NormalizedInsurance | null;
  slot2: NormalizedInsurance | null;
} {
  const list = Array.isArray(insurances) ? insurances : [];

  const medicalInsurances = list
    .filter((insurance) => {
      const record = insurance as InsuranceRecord;
      const name = getStringValue(record, [
        'payerName',
        'PayerName',
        'insuranceName',
        'InsuranceName',
        'name',
        'Name',
      ]);
      const type = getStringValue(record, [
        'type',
        'Type',
        'insuranceType',
        'InsuranceType',
        'planType',
        'PlanType',
      ]);

      const nameHasMedicare = containsIgnoreCase(name, 'medicare');
      const typeHasMedical = containsIgnoreCase(type, 'medical');

      if (type) {
        return typeHasMedical || nameHasMedicare;
      }
      return nameHasMedicare;
    })
    .map((insurance) => mapInsurance(insurance as InsuranceRecord));

  const selected = medicalInsurances.slice(0, 2);
  let slot1 = selected[0] ?? null;
  let slot2 = selected[1] ?? null;

  if (slot1 && slot2 && !slot1.isMedicare && slot2.isMedicare) {
    slot1 = slot2;
    slot2 = selected[0] ?? null;
  }

  return { slot1, slot2 };
}
