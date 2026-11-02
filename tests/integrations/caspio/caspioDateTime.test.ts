import {
  communityTimeZone,
  formatCaspioDateTime,
  parseCaspioSortableDate,
} from '../../../src/integrations/caspio/caspioDateTime.js';

describe('caspioDateTime', () => {
  it('maps YourLife communities to Central or Eastern', () => {
    expect(communityTimeZone('YourLife Pensacola')).toBe('America/Chicago');
    expect(communityTimeZone('YourLife Tallahassee')).toBe('America/New_York');
    expect(communityTimeZone('YourLife Coconut Creek')).toBe('America/New_York');
    expect(communityTimeZone('YourLife W Melbourne')).toBe('America/New_York');
    expect(communityTimeZone('YourLife West Melbourne')).toBe('America/New_York');
    expect(communityTimeZone('Test Community')).toBe('America/New_York');
  });

  it('keeps date-only values date-only', () => {
    expect(formatCaspioDateTime('2026-10-24', 'America/Chicago')).toBe('10/24/2026');
    expect(formatCaspioDateTime('2026-11-02', 'America/New_York')).toBe('11/02/2026');
    expect(formatCaspioDateTime('10/24/2026', 'America/Chicago')).toBe('10/24/2026');
  });

  it('writes instants in community local time across the November 1 clock change', () => {
    expect(formatCaspioDateTime('2026-10-24T05:00:00Z', 'America/Chicago')).toBe(
      '10/24/2026 00:00:00',
    );
    expect(formatCaspioDateTime('2026-10-24T04:00:00Z', 'America/New_York')).toBe(
      '10/24/2026 00:00:00',
    );
    expect(formatCaspioDateTime('2026-10-28T18:41:05Z', 'America/New_York')).toBe(
      '10/28/2026 14:41:05',
    );
    expect(formatCaspioDateTime('2026-10-28T18:41:05Z', 'America/Chicago')).toBe(
      '10/28/2026 13:41:05',
    );

    expect(formatCaspioDateTime('2026-11-02T18:41:05Z', 'America/New_York')).toBe(
      '11/02/2026 13:41:05',
    );
    expect(formatCaspioDateTime('2026-11-02T18:41:05Z', 'America/Chicago')).toBe(
      '11/02/2026 12:41:05',
    );
    expect(formatCaspioDateTime('2026-11-02T05:00:00Z', 'America/New_York')).toBe(
      '11/02/2026 00:00:00',
    );
    expect(formatCaspioDateTime('2026-11-02T06:00:00Z', 'America/Chicago')).toBe(
      '11/02/2026 00:00:00',
    );
  });

  it('treats zone-less ISO timestamps as UTC so the server zone cannot shift them', () => {
    expect(formatCaspioDateTime('2026-03-29T18:24:55.5416825', 'America/New_York')).toBe(
      '03/29/2026 14:24:55',
    );
  });

  it('parses legacy Caspio AM/PM timestamps for ordering', () => {
    const pm = parseCaspioSortableDate('10/27/2025 3:19:33 PM');
    const am = parseCaspioSortableDate('10/27/2025 3:19:33 AM');
    expect(pm).toBeGreaterThan(am);
    expect(Number.isFinite(pm)).toBe(true);
  });
});
