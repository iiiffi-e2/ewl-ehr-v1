import {
  buildYardiPulledDataSummary,
  extractYardiCommunityName,
  resolveEffectiveCuid,
} from '../../../src/integrations/yardi/yardiFhirSync.js';
import type { YardiFhirPatientBundle } from '../../../src/integrations/yardi/yardiFhirTypes.js';

describe('yardiFhirSync helpers', () => {
  it('builds a readable Yardi pull summary from a patient bundle', () => {
    const bundle: YardiFhirPatientBundle = {
      patientId: '31533-2',
      patient: {
        active: true,
        birthDate: '1932-07-15',
        name: [{ given: ['Waylon'], family: 'Frost' }],
      },
      encounterBundle: { entry: [{ resource: { resourceType: 'Encounter' } }] },
      coverageBundle: {
        entry: [
          {
            resource: {
              resourceType: 'Coverage',
              payor: [{ display: 'Medicare A' }],
            },
          },
        ],
      },
      conditionBundle: {
        entry: [
          {
            resource: {
              resourceType: 'Condition',
              code: { text: 'Hypertension' },
            },
          },
        ],
      },
    };

    const summary = buildYardiPulledDataSummary(bundle, {
      externalResidentId: '31533-2',
      status: 'active',
      firstName: 'Waylon',
      lastName: 'Frost',
      dateOfBirth: '1932-07-15T00:00:00.000Z',
      roomNumber: '101',
      bed: 'A',
      productType: 'Assisted Living',
      onPrem: true,
      onPremDate: '2026-04-01T00:00:00.000Z',
      offPrem: null,
      offPremDate: null,
    });

    expect(summary).toMatchObject({
      patientId: '31533-2',
      firstName: 'Waylon',
      lastName: 'Frost',
      coverage: ['Medicare A'],
      conditions: ['Hypertension'],
      encounterCount: 1,
      roomNumber: '101',
    });
  });

  it('extracts community name from encounter serviceProvider display', () => {
    const name = extractYardiCommunityName({
      patientId: '31533-2',
      patient: null,
      encounterBundle: {
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              serviceProvider: { display: 'EyeWatch Live TEST (eyewatch)' },
            },
          },
        ],
      },
      coverageBundle: {},
      conditionBundle: {},
    });

    expect(name).toBe('EyeWatch Live TEST (eyewatch)');
  });

  it('resolves a stable fallback CUID when enrichment is missing one', () => {
    expect(resolveEffectiveCuid({}, 237, '100')).toBe('COMM-237-100');
    expect(resolveEffectiveCuid({ CUID: '965' }, 237, '100')).toBe('965');
  });
});
