import {
  mapYardiHl7PartyFields,
  parseYardiHl7Contacts,
  parseYardiHl7Diagnoses,
  parseYardiHl7Insurances,
} from '../../../src/integrations/yardi/yardiHl7Parties.js';

function in1(fields: Record<number, string>): string {
  const parts = Array.from({ length: 37 }, () => '');
  parts[0] = 'IN1';
  for (const [index, value] of Object.entries(fields)) {
    parts[Number(index)] = value;
  }
  return parts.join('|');
}

const MESSAGE = [
  'MSH|^~\\&|Yardi|LNGFAY|EyeWatchLive|EyeWatchLive|20261116182020||ADT^A01|65789|P|2.5',
  'EVN|A01|20261116182020',
  'PID|1||426835||Bradley^Joe^||19320327000000|M',
  'PV1|1|I^Current|AL 200 hall^220^Single^LNGFAY',
  'NK1|2|Abrams^Robert^M|^Brother|8565 E Montebello Ave^Apt 102^Scottsdale^AZ^85351|6026953245|6026419745~~~6028521436',
  'NK1|1|Ngo^Roger^H|^Spouse|430 S Fairview Ave^^Goleta^CA^93117|5555555555',
  in1({ 1: '2', 2: '^Medicaid', 4: 'Medicaid', 15: 'MDCD', 36: 'CD6873803' }),
  in1({ 1: '1', 2: '^Medicare A/B', 4: 'Medicare A/B', 8: 'GRP1', 36: 'AB6873803' }),
  in1({ 1: '3', 2: '^Medicare D', 4: 'Medicare D', 36: 'GH6873803' }),
].join('\r');

describe('yardiHl7Parties', () => {
  it('reads the first two next-of-kin segments in set-id order', () => {
    expect(parseYardiHl7Contacts(MESSAGE)).toEqual([
      {
        name: 'Roger H Ngo',
        relationship: 'Spouse',
        phone: '5555555555',
        address: '430 S Fairview Ave, Goleta, CA 93117',
      },
      {
        name: 'Robert M Abrams',
        relationship: 'Brother',
        phone: '6026953245',
        address: '8565 E Montebello Ave, Apt 102, Scottsdale, AZ 85351',
      },
    ]);
  });

  it('reads the first two insurance segments in set-id order', () => {
    expect(parseYardiHl7Insurances(MESSAGE)).toEqual([
      {
        name: 'Medicare A/B',
        number: 'AB6873803',
        group: 'GRP1',
        type: undefined,
      },
      {
        name: 'Medicaid',
        number: 'CD6873803',
        group: undefined,
        type: 'Medicaid',
      },
    ]);
  });

  it('maps contacts and insurance onto the Caspio patient columns', () => {
    expect(mapYardiHl7PartyFields(MESSAGE)).toEqual({
      FamilyContact1Name: 'Roger H Ngo',
      FamilyContact1Relationship: 'Spouse',
      FamilyContact1Number: '5555555555',
      FamilyContact1Address: '430 S Fairview Ave, Goleta, CA 93117',
      FamilyContact2Name: 'Robert M Abrams',
      FamilyContact2Relationship: 'Brother',
      FamilyContact2Number: '6026953245',
      FamilyContact2Address: '8565 E Montebello Ave, Apt 102, Scottsdale, AZ 85351',
      PatientPrimaryInsurance: 'Medicare A/B',
      PrimaryInsuranceNum: 'AB6873803',
      GroupNumber1: 'GRP1',
      Secondinsurance: 'Medicaid',
      SecondInsuranceNum: 'CD6873803',
      Insurance_2_Type: 'Medicaid',
    });
  });

  it('joins every DG1 diagnosis into Diagnosis1 in set-id order', () => {
    const hl7 = [
      'DG1|2||E11^Type 2 diabetes mellitus^I10^|||W',
      'DG1|1||J44.9^Chronic obstructive pulmonary disease, unspecified^I10^|||W',
      'DG1|3||I10^Essential (primary) hypertension^I10^|||W',
    ].join('\r');

    expect(parseYardiHl7Diagnoses(hl7)).toEqual([
      'J44.9 Chronic obstructive pulmonary disease, unspecified',
      'E11 Type 2 diabetes mellitus',
      'I10 Essential (primary) hypertension',
    ]);
    expect(mapYardiHl7PartyFields(hl7)).toEqual({
      Diagnosis1:
        'J44.9 Chronic obstructive pulmonary disease, unspecified; E11 Type 2 diabetes mellitus; I10 Essential (primary) hypertension',
    });
  });

  it('returns no party fields when the message has neither segment', () => {
    expect(mapYardiHl7PartyFields('MSH|^~\\&|Yardi|LNGFAY\rPID|1||1')).toEqual({});
  });
});