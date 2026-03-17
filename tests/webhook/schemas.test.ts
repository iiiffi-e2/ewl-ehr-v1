import { isSupportedEventType } from '../../src/webhook/schemas.js';

describe('webhook schema supported event types', () => {
  it('supports additional resident lifecycle event types observed from ALIS', () => {
    expect(isSupportedEventType('residents.created')).toBe(true);
    expect(isSupportedEventType('residents.health_profile_updated')).toBe(true);
    expect(isSupportedEventType('resident.room_assigned')).toBe(true);
  });
});
