import {
  isSupportedYardiHl7EventType,
  isSupportedYardiHl7Trigger,
  labelForYardiHl7Trigger,
  lifecycleFromYardiHl7EventType,
  lifecycleFromYardiHl7Trigger,
} from '../../../src/integrations/yardi/yardiHl7Triggers.js';

describe('yardiHl7Triggers', () => {
  it('maps supported codes to lifecycle kinds', () => {
    expect(lifecycleFromYardiHl7Trigger('A01')).toBe('move_in');
    expect(lifecycleFromYardiHl7Trigger('A03')).toBe('move_out');
    expect(lifecycleFromYardiHl7Trigger('A21')).toBe('leave_start');
    expect(lifecycleFromYardiHl7Trigger('A22')).toBe('leave_end');
    expect(lifecycleFromYardiHl7Trigger('A02')).toBe('update');
    expect(lifecycleFromYardiHl7Trigger('A08')).toBe('update');
    expect(lifecycleFromYardiHl7Trigger('A05')).toBe('created');
    expect(lifecycleFromYardiHl7Trigger('A60')).toBe('update');
  });

  it('treats cancel codes as unsupported', () => {
    for (const code of ['A11', 'A12', 'A13', 'A38']) {
      expect(isSupportedYardiHl7Trigger(code)).toBe(false);
      expect(isSupportedYardiHl7EventType(`hl7.adt.${code.toLowerCase()}`)).toBe(false);
    }
  });

  it('labels supported trigger codes', () => {
    expect(labelForYardiHl7Trigger('A01')).toBe('Move-in');
    expect(labelForYardiHl7Trigger('a02')).toBe('Room transfer');
    expect(labelForYardiHl7Trigger('A03')).toBe('Move-out');
    expect(labelForYardiHl7Trigger('A21')).toBe('Leave start');
  });

  it('parses eventType hl7.adt.a01', () => {
    expect(isSupportedYardiHl7EventType('hl7.adt.a01')).toBe(true);
    expect(lifecycleFromYardiHl7EventType('hl7.adt.a01')).toBe('move_in');
  });
});
