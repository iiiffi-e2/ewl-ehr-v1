import { AsyncLocalStorage } from 'node:async_hooks';

export type CaspioRecordedOperation = {
  table: string;
  action: 'upsert' | 'update';
  fields?: unknown;
  record?: unknown;
  id?: string | number;
};

type RecorderStore = {
  dryRun: boolean;
  operations: CaspioRecordedOperation[];
};

const storage = new AsyncLocalStorage<RecorderStore>();

export function getRecordedCaspioOperations(error: unknown): CaspioRecordedOperation[] {
  if (error && typeof error === 'object' && 'caspioOperations' in error) {
    const operations = (error as { caspioOperations?: unknown }).caspioOperations;
    return Array.isArray(operations) ? (operations as CaspioRecordedOperation[]) : [];
  }
  return [];
}

export async function runWithCaspioWriteRecorder<T>(
  options: { dryRun: boolean },
  fn: () => Promise<T>,
): Promise<{ result: T; operations: CaspioRecordedOperation[] }> {
  const store: RecorderStore = { dryRun: options.dryRun, operations: [] };
  try {
    const result = await storage.run(store, fn);
    return { result, operations: store.operations };
  } catch (error) {
    if (error && typeof error === 'object') {
      (error as { caspioOperations?: CaspioRecordedOperation[] }).caspioOperations = store.operations;
    }
    throw error;
  }
}

export function noteCaspioWrite(operation: CaspioRecordedOperation): 'passthrough' | 'block' {
  const store = storage.getStore();
  if (!store) return 'passthrough';
  store.operations.push(operation);
  return store.dryRun ? 'block' : 'passthrough';
}
