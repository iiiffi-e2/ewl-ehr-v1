import { normalizeMedicalInsurances } from '../../../src/integrations/caspio/insuranceNormalization.js';

describe('normalizeMedicalInsurances', () => {
  it('promotes a Medicare name to primary when listed second', () => {
    const insurances = [
      { payerName: 'Kaiser', type: 'dental' },
      { payerName: 'Medicare Advantage', type: 'dental' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2?.name).toMatch(/kaiser/i);
  });

  it('keeps Medicare in primary when already first', () => {
    const insurances = [
      { payerName: 'Medicare Part A' },
      { payerName: 'BCBS' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2?.name).toMatch(/bcbs/i);
  });

  it('treats Medicaid in the name as primary', () => {
    const insurances = [
      { payerName: 'Aetna' },
      { payerName: 'State Medicaid Plan' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicaid/i);
    expect(result.slot2?.name).toMatch(/aetna/i);
  });

  it('does not use type at all (medical type alone is not promoted)', () => {
    const insurances = [
      { payerName: 'Aetna', type: 'medical' },
      { payerName: 'BCBS', type: 'dental' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/aetna/i);
    expect(result.slot2?.name).toMatch(/bcbs/i);
  });

  it('preserves order when no Medicare/Medicaid is present (first other = primary)', () => {
    const insurances = [
      { payerName: 'Aetna' },
      { payerName: 'BCBS' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/aetna/i);
    expect(result.slot2?.name).toMatch(/bcbs/i);
  });

  it('keeps order when both are Medicare/Medicaid (first = primary, second = secondary)', () => {
    const insurances = [
      { payerName: 'Medicare Part A' },
      { payerName: 'Medicaid Supplement' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare part a/i);
    expect(result.slot2?.name).toMatch(/medicaid supplement/i);
  });

  it('ignores a 3rd insurance entirely', () => {
    const insurances = [
      { payerName: 'Aetna' },
      { payerName: 'BCBS' },
      { payerName: 'Medicare' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/aetna/i);
    expect(result.slot2?.name).toMatch(/bcbs/i);
  });

  it('handles a single insurance with empty secondary', () => {
    const insurances = [{ payerName: 'Medicare' }];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2).toBeNull();
  });

  it('returns empty slots for an empty list', () => {
    const result = normalizeMedicalInsurances([]);

    expect(result.slot1).toBeNull();
    expect(result.slot2).toBeNull();
  });
});
