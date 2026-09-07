const envState = {
  YARDI_HL7_POLL_TARGETS: undefined as string | undefined,
  YARDI_HL7_SENDING_FACILITY: 'EYELIVE',
  YARDI_FHIR_POLL_TARGETS: undefined as string | undefined,
};

jest.mock('../../../src/config/env.js', () => ({
  env: envState,
}));

import {
  getConfiguredYardiHl7PollTargets,
  parseYardiHl7PollTargets,
  resolveYardiHl7Facility,
} from '../../../src/integrations/yardi/yardiHl7PollConfig.js';

describe('parseYardiHl7PollTargets', () => {
  it('parses comma-separated roster entries', () => {
    expect(parseYardiHl7PollTargets('yourlife:113:EYELIVE,other:200:FAC2')).toEqual([
      { companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' },
      { companyKey: 'other', communityId: 200, facilityId: 'FAC2' },
    ]);
  });

  it('parses JSON roster entries', () => {
    expect(
      parseYardiHl7PollTargets(
        '[{"companyKey":"yourlife","communityId":113,"facilityId":"EYELIVE"}]',
      ),
    ).toEqual([{ companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' }]);
  });

  it('parses JSON roster entries with string communityId', () => {
    expect(
      parseYardiHl7PollTargets(
        '[{"companyKey":"yourlife","communityId":"113","facilityId":"EYELIVE"}]',
      ),
    ).toEqual([{ companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' }]);
  });

  it('strips wrapping quotes from compact roster values', () => {
    expect(parseYardiHl7PollTargets('"eyewatch:237:EYELIVE"')).toEqual([
      { companyKey: 'eyewatch', communityId: 237, facilityId: 'EYELIVE' },
    ]);
    expect(parseYardiHl7PollTargets("'eyewatch:237:EYELIVE'")).toEqual([
      { companyKey: 'eyewatch', communityId: 237, facilityId: 'EYELIVE' },
    ]);
  });

  it('returns empty array for blank input', () => {
    expect(parseYardiHl7PollTargets(undefined)).toEqual([]);
    expect(parseYardiHl7PollTargets('')).toEqual([]);
  });

  it('rejects incomplete compact entries', () => {
    expect(() => parseYardiHl7PollTargets('yourlife:113')).toThrow(/YARDI_HL7_POLL_TARGETS/);
  });

  it('rejects compact entries with whitespace-only fields', () => {
    expect(() => parseYardiHl7PollTargets(' :113: ')).toThrow(/YARDI_HL7_POLL_TARGETS/);
  });

  it('rejects compact entries with whitespace-only communityId', () => {
    expect(() => parseYardiHl7PollTargets('yourlife: :EYELIVE')).toThrow(/YARDI_HL7_POLL_TARGETS/);
  });
});

describe('getConfiguredYardiHl7PollTargets', () => {
  beforeEach(() => {
    envState.YARDI_HL7_POLL_TARGETS = undefined;
    envState.YARDI_FHIR_POLL_TARGETS = undefined;
    envState.YARDI_HL7_SENDING_FACILITY = 'EYELIVE';
  });

  it('returns the explicit HL7 roster when set', () => {
    envState.YARDI_HL7_POLL_TARGETS = 'eyewatch:237:EYELIVE';
    expect(getConfiguredYardiHl7PollTargets()).toEqual([
      { companyKey: 'eyewatch', communityId: 237, facilityId: 'EYELIVE' },
    ]);
  });

  it('derives a single-community roster from FHIR targets when HL7 roster is empty', () => {
    envState.YARDI_FHIR_POLL_TARGETS = 'eyewatch:237:org-123';
    expect(getConfiguredYardiHl7PollTargets()).toEqual([
      { companyKey: 'eyewatch', communityId: 237, facilityId: 'EYELIVE' },
    ]);
  });

  it('does not derive from FHIR when more than one FHIR community is configured', () => {
    envState.YARDI_FHIR_POLL_TARGETS = 'eyewatch:237:org-123,eyewatch:240:org-456';
    expect(getConfiguredYardiHl7PollTargets()).toEqual([]);
  });
});

describe('resolveYardiHl7Facility', () => {
  const targets = [{ companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' }];

  it('matches MSH.4 facility case-insensitively', () => {
    expect(resolveYardiHl7Facility('eyelive', targets)).toEqual(targets[0]);
  });

  it('returns null for unknown facility', () => {
    expect(resolveYardiHl7Facility('NOPE', targets)).toBeNull();
    expect(resolveYardiHl7Facility(null, targets)).toBeNull();
  });
});
