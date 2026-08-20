import {
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

  it('returns empty array for blank input', () => {
    expect(parseYardiHl7PollTargets(undefined)).toEqual([]);
    expect(parseYardiHl7PollTargets('')).toEqual([]);
  });

  it('rejects incomplete compact entries', () => {
    expect(() => parseYardiHl7PollTargets('yourlife:113')).toThrow(/YARDI_HL7_POLL_TARGETS/);
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
