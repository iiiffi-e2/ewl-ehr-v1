import { parseYardiFhirPollTargets } from '../../../src/integrations/yardi/yardiFhirPollConfig.js';

describe('parseYardiFhirPollTargets', () => {
  it('parses comma-separated poll targets', () => {
    expect(parseYardiFhirPollTargets('yardi-co:113:32-1,other:200:44-2')).toEqual([
      { companyKey: 'yardi-co', communityId: 113, organizationId: '32-1' },
      { companyKey: 'other', communityId: 200, organizationId: '44-2' },
    ]);
  });

  it('parses JSON poll targets', () => {
    expect(
      parseYardiFhirPollTargets(
        '[{"companyKey":"yardi-co","communityId":113,"organizationId":"32-1"}]',
      ),
    ).toEqual([{ companyKey: 'yardi-co', communityId: 113, organizationId: '32-1' }]);
  });
});
