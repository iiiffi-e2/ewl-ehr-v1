import { getRedisConnection } from '../../workers/connection.js';

export type SyncCursorStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export function createRedisSyncCursorStore(): SyncCursorStore {
  const redis = getRedisConnection();
  return {
    async get(key: string): Promise<string | null> {
      return redis.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      await redis.set(key, value);
    },
  };
}
