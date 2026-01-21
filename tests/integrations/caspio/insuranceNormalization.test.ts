import { normalizeMedicalInsurances } from '../../../src/integrations/caspio/insuranceNormalization.js';

describe('normalizeMedicalInsurances', () => {
  it('places Medicare first when second in list', () => {
    const insurances = [
      { payerName: 'Kaiser', type: 'medical' },
      { payerName: 'Medicare Advantage', type: 'medical' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2?.name).toMatch(/kaiser/i);
  });

  it('keeps ordering when Medicare is already first', () => {
    const insurances = [
      { payerName: 'Medicare Part A', type: 'medical' },
      { payerName: 'BCBS', type: 'medical' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2?.name).toMatch(/bcbs/i);
  });

  it('keeps ordering when no Medicare present', () => {
    const insurances = [
      { payerName: 'Aetna', type: 'medical' },
      { payerName: 'BCBS', type: 'medical' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/aetna/i);
    expect(result.slot2?.name).toMatch(/bcbs/i);
  });

  it('handles single Medicare insurance', () => {
    const insurances = [{ payerName: 'Medicare', type: 'medical' }];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2).toBeNull();
  });

  it('applies Medicare-first ordering to first two selections', () => {
    const insurances = [
      { payerName: 'Aetna', type: 'medical' },
      { payerName: 'Medicare', type: 'medical' },
      { payerName: 'BCBS', type: 'medical' },
    ];

    const result = normalizeMedicalInsurances(insurances);

    expect(result.slot1?.name).toMatch(/medicare/i);
    expect(result.slot2?.name).toMatch(/aetna/i);
  });
});
