import {
  getYardiConditionTexts,
  getYardiCoverageNames,
  mapYardiFhirBundleToDemographics,
} from '../../../src/integrations/yardi/yardiFhirDemographics.js';
import type { YardiFhirPatientBundle } from '../../../src/integrations/yardi/yardiFhirTypes.js';

describe('yardiFhirDemographics', () => {
  const bundle: YardiFhirPatientBundle = {
    patientId: '5881-2',
    patient: {
      resourceType: 'Patient',
      id: '5881-2',
      active: true,
      birthDate: '1967-05-18',
      name: [{ family: 'Adams', given: ['Beatrice'] }],
    },
    encounterBundle: {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Encounter',
            status: 'in-progress',
            period: { start: '2021-01-17T11:11:00-08:00' },
            type: [{ text: 'Assisted Living' }],
            location: [{ location: { display: 'wzone1, 102, Double A' } }],
          },
        },
      ],
    },
    coverageBundle: {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Coverage',
            payor: [{ display: 'Medicare Part A' }],
          },
        },
      ],
    },
    conditionBundle: {
      resourceType: 'Bundle',
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

  it('maps patient and encounter fields into canonical demographics', () => {
    const demographics = mapYardiFhirBundleToDemographics(bundle);

    expect(demographics).toMatchObject({
      externalResidentId: '5881-2',
      firstName: 'Beatrice',
      lastName: 'Adams',
      status: 'active',
      roomNumber: '102',
      bed: 'Double A',
      room: '102 Double A',
      productType: 'Assisted Living',
      onPrem: true,
    });
  });

  it('extracts coverage and condition helper values', () => {
    expect(getYardiCoverageNames(bundle)).toEqual(['Medicare Part A']);
    expect(getYardiConditionTexts(bundle)).toEqual(['Hypertension']);
  });
});
