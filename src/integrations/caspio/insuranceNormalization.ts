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
    'providerName',
    'ProviderName',
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
    'accountNumber',
    'AccountNumber',
    'insuranceNumber',
    'InsuranceNumber',
  ]);
  const isMedicare = isMedicareOrMedicaidName(name);

  return {
    name,
    type,
    group,
    number,
    isMedicare,
  };
}

function isMedicareOrMedicaidName(name: string | null): boolean {
  return containsIgnoreCase(name, 'medicare') || containsIgnoreCase(name, 'medicaid');
}

/**
 * Splits a resident's insurances into a primary and secondary slot.
 *
 * Rules:
 * - Type is never used for filtering; all insurances are candidates.
 * - Only the first two insurances are considered; any additional ones
 *   (e.g. a 3rd) are ignored.
 * - Primary (slot1) is the insurance whose name contains "medicare" or
 *   "medicaid". If only the second of the two is Medicare/Medicaid, it is
 *   promoted ahead of the other.
 * - Otherwise the original order is preserved (first = primary,
 *   second = secondary), so two "other" companies or two Medicare/Medicaid
 *   plans keep their listed order.
 */
export function normalizeMedicalInsurances(insurances: any[]): {
  slot1: NormalizedInsurance | null;
  slot2: NormalizedInsurance | null;
} {
  const list = Array.isArray(insurances) ? insurances : [];

  const selected = list.slice(0, 2);
  let slot1 = selected[0] ? mapInsurance(selected[0] as InsuranceRecord) : null;
  let slot2 = selected[1] ? mapInsurance(selected[1] as InsuranceRecord) : null;

  if (slot1 && slot2 && !slot1.isMedicare && slot2.isMedicare) {
    const temp = slot1;
    slot1 = slot2;
    slot2 = temp;
  }

  return { slot1, slot2 };
}
