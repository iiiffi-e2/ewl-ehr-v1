import {
  extractYardiCommunityNameFromPatient,
  getYardiConditionTexts,
  getYardiCoverageNames,
  getYardiNormalizedCoverages,
  getYardiPatientContacts,
  getYardiPatientPhone,
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

  it('ignores patient self-payor entries when extracting insurance names', () => {
    const waylonBundle: YardiFhirPatientBundle = {
      ...bundle,
      patient: {
        name: [{ given: ['Waylon'], family: 'Frost' }],
      },
      coverageBundle: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Coverage',
              subscriberId: 'POL123',
              type: { text: 'Commercial' },
              class: [{ type: { coding: [{ code: 'group' }] }, value: 'GRP456' }],
              payor: [
                { display: 'Waylon Frost', reference: 'Patient/31533-2' },
                { display: 'Big Insurance Co.', reference: 'Organization/6634-6' },
              ],
            },
          },
        ],
      },
    };

    expect(getYardiCoverageNames(waylonBundle)).toEqual(['Big Insurance Co.']);
    expect(getYardiNormalizedCoverages(waylonBundle)).toMatchObject({
      slot1: {
        name: 'Big Insurance Co.',
        number: 'POL123',
        group: 'GRP456',
        type: 'Commercial',
      },
      slot2: null,
    });
  });

  it('maps patient telecom and emergency contacts from FHIR Patient.contact', () => {
    const patient = {
      telecom: [{ system: 'phone', value: '2224445555', use: 'mobile' }],
      contact: [
        {
          relationship: [{ text: 'Conservator' }],
          name: { given: ['WRJ'], family: 'Non-Revocable Trust' },
          telecom: [
            { system: 'phone', value: '3335556666', use: 'work' },
            { system: 'email', value: 'wrjtrust@email.com' },
          ],
          address: { city: 'Chicago', state: 'IL', postalCode: '83702' },
        },
        {
          relationship: [{ text: 'Daughter' }],
          name: { given: ['Lydia'], family: 'Frost' },
          telecom: [
            { system: 'phone', value: '5551113333', use: 'mobile' },
            { system: 'email', value: 'lydiaf@email.com' },
          ],
        },
      ],
    };

    expect(getYardiPatientPhone(patient)).toBe('2224445555');
    expect(getYardiPatientContacts(patient)).toEqual([
      {
        name: 'WRJ Non-Revocable Trust',
        relationship: 'Conservator',
        phone: '3335556666',
        email: 'wrjtrust@email.com',
        address: 'Chicago, IL, 83702',
      },
      {
        name: 'Lydia Frost',
        relationship: 'Daughter',
        phone: '5551113333',
        email: 'lydiaf@email.com',
        address: undefined,
      },
    ]);
  });

  it('extracts community name from managingOrganization when encounter lacks serviceProvider', () => {
    expect(
      extractYardiCommunityNameFromPatient({
        managingOrganization: { display: 'EyeWatch Live TEST' },
      }),
    ).toBe('EyeWatch Live TEST');
  });

  it('parses room and bed from a two-part Yardi location display', () => {
    const demographics = mapYardiFhirBundleToDemographics({
      ...bundle,
      encounterBundle: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              status: 'in-progress',
              location: [{ location: { display: '102, Double A' } }],
            },
          },
        ],
      },
    });

    expect(demographics).toMatchObject({
      roomNumber: '102',
      bed: 'Double A',
      room: '102 Double A',
    });
  });

  it('does not treat a facility display name as a room number', () => {
    const demographics = mapYardiFhirBundleToDemographics({
      ...bundle,
      encounterBundle: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              status: 'in-progress',
              type: [{ text: 'Provision of continuity of care' }],
              location: [{ location: { display: 'EyeWatch Live TEST (eyewatch)' } }],
            },
          },
        ],
      },
    });

    expect(demographics.roomNumber).toBeNull();
    expect(demographics.bed).toBeNull();
    expect(demographics.room).toBeNull();
  });

  it('parses Yardi multi-location encounter assignments', () => {
    const demographics = mapYardiFhirBundleToDemographics({
      ...bundle,
      encounterBundle: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              status: 'in-progress',
              type: [{ text: 'Provision of continuity of care' }],
              text: {
                status: 'generated',
                div: '<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Location</b>: First Floor, 100, Double A</p></div>',
              },
              location: [
                { location: { display: 'EyeWatch Live TEST (eyewatch)' } },
                { location: { display: 'First Floor' } },
                { location: { display: '100' } },
                { location: { display: 'Double A' } },
              ],
            },
          },
        ],
      },
    });

    expect(demographics).toMatchObject({
      roomNumber: '100',
      bed: 'Double A',
      room: '100 Double A',
    });
  });
});
