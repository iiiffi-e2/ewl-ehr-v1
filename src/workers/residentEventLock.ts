import { randomUUID } from 'node:crypto';

import { getRedisConnection } from './connection.js';

type RedisLike = {
  set: (...args: unknown[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  eval: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<unknown>;
};

const memoryTails = new Map<string, Promise<void>>();
const memoryLifecycle = new Map<string, number>();

const LOCK_TTL_MS = 120_000;
const LOCK_ATTEMPTS = 40;

const SET_IF_GREATER = `
local current = redis.call('get', KEYS[1])
if (not current) or (tonumber(ARGV[1]) > tonumber(current)) then
  redis.call('set', KEYS[1], ARGV[1])
end
return 1
`;

const RELEASE_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

export function residentLifecycleKey(companyId: number, residentId: number | string): string {
  return `${companyId}:${residentId}`;
}

export function clearResidentEventStateForTests(): void {
  memoryTails.clear();
  memoryLifecycle.clear();
}

export async function rememberResidentLifecycle(
  key: string,
  eventTimeIso: string | undefined,
): Promise<void> {
  const ms = eventTimeMs(eventTimeIso);
  if (ms === undefined) return;
  const previous = memoryLifecycle.get(key) ?? Number.NEGATIVE_INFINITY;
  if (ms > previous) {
    memoryLifecycle.set(key, ms);
  }
  const redis = redisClient();
  if (!redis) return;
  await redis.eval(SET_IF_GREATER, 1, lifecycleRedisKey(key), String(ms));
}

export async function isStaleResidentUpdate(
  key: string,
  eventTimeIso: string | undefined,
): Promise<boolean> {
  const eventMs = eventTimeMs(eventTimeIso);
  if (eventMs === undefined) return false;
  let latest = memoryLifecycle.get(key);
  const redis = redisClient();
  if (redis) {
    const stored = await redis.get(lifecycleRedisKey(key));
    const storedMs = stored === null ? undefined : Number(stored);
    if (storedMs !== undefined && Number.isFinite(storedMs)) {
      latest = latest === undefined ? storedMs : Math.max(latest, storedMs);
    }
  }
  if (latest === undefined) return false;
  return eventMs < latest;
}

export async function withResidentLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const redis = redisClient();
  if (!redis) {
    return withMemoryLock(key, fn);
  }
  return withRedisLock(redis, key, fn);
}

function eventTimeMs(value: string | undefined): number | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function lifecycleRedisKey(key: string): string {
  return `alis-resident-lifecycle:${key}`;
}

function redisClient(): RedisLike | null {
  if (process.env.NODE_ENV === 'test') return null;
  try {
    const client = getRedisConnection() as Partial<RedisLike>;
    if (
      typeof client.set !== 'function' ||
      typeof client.get !== 'function' ||
      typeof client.eval !== 'function'
    ) {
      return null;
    }
    return client as RedisLike;
  } catch {
    return null;
  }
}

async function withMemoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = memoryTails.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  memoryTails.set(
    key,
    previous.then(() => gate),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function withRedisLock<T>(redis: RedisLike, key: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `alis-resident-lock:${key}`;
  const token = randomUUID();
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const acquired = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired) {
      try {
        return await fn();
      } finally {
        await redis.eval(RELEASE_LOCK, 1, lockKey, token);
      }
    }
    await delay(50 + attempt * 25);
  }
  throw new Error(`Timed out waiting for resident event lock ${key}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
