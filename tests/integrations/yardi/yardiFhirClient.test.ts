import { parsePatientReference } from '../../../src/integrations/yardi/yardiFhirClient.js';

describe('parsePatientReference', () => {
  it('extracts patient id from Patient reference', () => {
    expect(parsePatientReference('Patient/5881-2')).toBe('5881-2');
  });

  it('returns bare ids unchanged', () => {
    expect(parsePatientReference('5881-2')).toBe('5881-2');
  });
});
