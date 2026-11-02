import {
  clearResidentEventStateForTests,
  isStaleResidentUpdate,
  rememberResidentLifecycle,
  residentLifecycleKey,
  withResidentLock,
} from '../../src/workers/residentEventLock.js';

describe('residentEventLock', () => {
  beforeEach(() => {
    clearResidentEventStateForTests();
  });

  it('treats an update older than the recorded lifecycle as stale and keeps a newer one', async () => {
    const key = residentLifecycleKey(10, 70508);
    await rememberResidentLifecycle(key, '2026-10-28T18:41:05Z');

    await expect(isStaleResidentUpdate(key, '2026-10-28T18:40:59Z')).resolves.toBe(true);
    await expect(isStaleResidentUpdate(key, '2026-10-28T18:41:05Z')).resolves.toBe(false);
    await expect(isStaleResidentUpdate(key, '2026-10-28T18:42:00Z')).resolves.toBe(false);
  });

  it('keeps the later lifecycle time when events arrive out of order', async () => {
    const key = residentLifecycleKey(10, 70508);
    await rememberResidentLifecycle(key, '2026-10-28T18:41:05Z');
    await rememberResidentLifecycle(key, '2026-10-20T12:00:00Z');

    await expect(isStaleResidentUpdate(key, '2026-10-28T18:40:59Z')).resolves.toBe(true);
  });

  it('serializes work for one key', async () => {
    let active = 0;
    let max = 0;
    const run = () =>
      withResidentLock('10:70508', async () => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      });

    await Promise.all([run(), run()]);
    expect(max).toBe(1);
  });
});