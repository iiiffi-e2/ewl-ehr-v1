# Yardi HL7 Workflow Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin page and API that injects or replays a Yardi HL7 ADT through the existing Caspio workflows, plus Dry-run / Replay on `/monitor`.

**Architecture:** `runYardiHl7Test` builds or remints HL7, parses with `YardiHl7AdtAdapter`, persists a new EventLog row, then either runs `processAlisEventJob` inline (optional Caspio write interception for dry-run) or enqueues `process-alis-event`. The tester page and monitor buttons are thin clients of `POST /admin/yardi-hl7-test/run`.

**Tech Stack:** TypeScript, Express, Jest, BullMQ, existing `YardiHl7AdtAdapter` / `processAlisEvent` / Caspio client

**Spec:** `docs/superpowers/specs/2026-09-07-yardi-hl7-workflow-tester-design.md`

## Global Constraints

- Live Caspio write is the default. Optional dry-run shows planned writes and never upserts.
- Always persist a **new** EventLog row. Mint a new MSH-10 so replay is never a duplicate. The original row is not mutated.
- Never call GetMessage or ProcessACK.
- Existing admin BasicAuth.
- FHIR overlay runs the same as production when `companyKey` + `communityId` is in `YARDI_FHIR_POLL_TARGETS`. No extra skip flag.
- Honor `EHR_ADAPTER_ENABLED`, `EHR_ENABLED_COMMUNITY_IDS`, and `EHR_SHADOW_MODE`. If a live run skips Caspio because of a gate, the response must say so (`caspio.wrote: false` + `skipReason`).
- `skipReason` is exactly one of: `null`, `dry_run`, `unknown_facility`, `unsupported_trigger`, `ehr_adapter_disabled`, `ehr_community_not_enabled`, `ehr_shadow_mode`, `missing_cuid`.
- ALIS webhook and Yardi FHIR poll paths stay unchanged.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/integrations/yardi/yardiHl7TestMessage.ts` | Build canned ADT; remint MSH-10; extract HL7 from EventLog payload |
| `src/integrations/caspio/caspioWriteRecorder.ts` | AsyncLocalStorage recorder for Caspio writes |
| `src/integrations/caspio/caspioClient.ts` | Honor recorder in `upsertByFields` and `updateRecordById` |
| `src/workers/processAlisEvent.ts` | Export `processAlisEventJob`; worker calls it |
| `src/admin/yardiHl7Test.ts` | Config + `runYardiHl7Test` |
| `src/http/routes.ts` | Page redirect, config, run |
| `public/yardi-hl7-test.html` | Tester page |
| `public/webhook-monitor.html` | Dry-run / Replay + link to tester |
| `tests/integrations/yardi/yardiHl7TestMessage.test.ts` | Builder / remint / extract |
| `tests/integrations/caspio/caspioWriteRecorder.test.ts` | Dry-run blocks writes |
| `tests/workers/processAlisEvent.test.ts` | Existing worker tests still pass after extract |
| `tests/admin/yardiHl7Test.test.ts` | Runner modes and guards |
| `tests/http/yardiHl7Test.routes.test.ts` | Auth and validation |

---

### Task 1: HL7 builder, remint, and payload extract

**Files:**
- Create: `src/integrations/yardi/yardiHl7TestMessage.ts`
- Create: `tests/integrations/yardi/yardiHl7TestMessage.test.ts`

**Interfaces:**
- Consumes: `YardiHl7AdtAdapter.parseInboundEvent` (used only in tests)
- Produces:
  - `mintYardiHl7MessageControlId(): string` — `T` + 13-digit unix ms + 4 hex chars, max 20 chars
  - `buildYardiHl7Adt(input: BuildYardiHl7AdtInput): string`
  - `remintYardiHl7MessageControlId(hl7: string): { hl7: string; messageControlId: string }`
  - `extractYardiHl7FromEventPayload(payload: unknown): string | null`
  - `BuildYardiHl7AdtInput = { trigger: string; residentId: string | number; roomNumber: string; facilityId: string; firstName?: string; lastName?: string; dateOfBirth?: string; gender?: string; messageControlId?: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/yardi/yardiHl7TestMessage.test.ts`:

```ts
import { YardiHl7AdtAdapter } from '../../../src/integrations/ehr/yardiHl7AdtAdapter.js';
import {
  buildYardiHl7Adt,
  extractYardiHl7FromEventPayload,
  mintYardiHl7MessageControlId,
  remintYardiHl7MessageControlId,
} from '../../../src/integrations/yardi/yardiHl7TestMessage.js';

const TRIGGERS = ['A01', 'A02', 'A03', 'A05', 'A08', 'A21', 'A22', 'A60'] as const;

describe('yardiHl7TestMessage', () => {
  it('mints a message-control id at most 20 characters', () => {
    const id = mintYardiHl7MessageControlId();
    expect(id.startsWith('T')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(20);
    expect(id.length).toBeGreaterThanOrEqual(14);
  });

  it.each(TRIGGERS)('builds a parseable %s ADT', (trigger) => {
    const hl7 = buildYardiHl7Adt({
      trigger,
      residentId: '418612',
      roomNumber: '141',
      facilityId: 'EYELIVE',
      firstName: 'Denise',
      lastName: 'Morgan',
      dateOfBirth: '1940-01-02',
      gender: 'F',
    });
    const event = new YardiHl7AdtAdapter().parseInboundEvent(hl7);
    expect(event.eventType).toBe(`hl7.adt.${trigger.toLowerCase()}`);
    expect(event.notificationData.ResidentId).toBe(418612);
    expect(event.notificationData.RoomNumber).toBe('141');
    expect(event.notificationData.SendingFacility).toBe('EYELIVE');
    expect(String(event.eventMessageId).length).toBeLessThanOrEqual(20);
  });

  it('defaults name to Resident^Test when omitted', () => {
    const hl7 = buildYardiHl7Adt({
      trigger: 'A01',
      residentId: 99,
      roomNumber: '1',
      facilityId: 'EYELIVE',
    });
    expect(hl7).toContain('Resident^Test^');
  });

  it('replaces MSH-10 and keeps other fields', () => {
    const original = [
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A08|10529|P|2.5',
      'EVN|A08|20220908043209',
      'PID|1||418612||Morgan^Denise^||20220901000000|F',
      'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
    ].join('\r');
    const reminted = remintYardiHl7MessageControlId(original);
    expect(reminted.messageControlId).not.toBe('10529');
    expect(reminted.hl7).toContain(`|${reminted.messageControlId}|`);
    expect(reminted.hl7).not.toContain('|10529|');
    expect(reminted.hl7).toContain('ADT^A08');
    expect(reminted.hl7).toContain('418612');
  });

  it('extracts HL7 from notificationData.Message then raw.message', () => {
    const hl7 = 'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|dt||ADT^A01|1|P|2.5';
    expect(
      extractYardiHl7FromEventPayload({
        notificationData: { Message: hl7 },
        raw: { message: 'MSH|other' },
      }),
    ).toBe(hl7);
    expect(extractYardiHl7FromEventPayload({ raw: { message: hl7 } })).toBe(hl7);
    expect(extractYardiHl7FromEventPayload({ notificationData: { Message: 'nope' } })).toBeNull();
    expect(extractYardiHl7FromEventPayload({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/integrations/yardi/yardiHl7TestMessage.test.ts`

Expected: FAIL with `Cannot find module` for `yardiHl7TestMessage.js`

- [ ] **Step 3: Write minimal implementation**

Create `src/integrations/yardi/yardiHl7TestMessage.ts`:

```ts
export type BuildYardiHl7AdtInput = {
  trigger: string;
  residentId: string | number;
  roomNumber: string;
  facilityId: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  messageControlId?: string;
};

function randomHex4(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
}

export function mintYardiHl7MessageControlId(): string {
  return `T${Date.now()}${randomHex4()}`.slice(0, 20);
}

function formatHl7DateTime(value = new Date()): string {
  const yyyy = String(value.getUTCFullYear());
  const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(value.getUTCDate()).padStart(2, '0');
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const min = String(value.getUTCMinutes()).padStart(2, '0');
  const ss = String(value.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

function formatPidDate(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}${trimmed.slice(5, 7)}${trimmed.slice(8, 10)}000000`;
  }
  return trimmed;
}

export function buildYardiHl7Adt(input: BuildYardiHl7AdtInput): string {
  const trigger = input.trigger.trim().toUpperCase();
  const facilityId = input.facilityId.trim();
  const messageControlId = input.messageControlId ?? mintYardiHl7MessageControlId();
  const hl7DateTime = formatHl7DateTime();
  const lastName = (input.lastName ?? 'Resident').trim() || 'Resident';
  const firstName = (input.firstName ?? 'Test').trim() || 'Test';
  const msh = [
    'MSH',
    '^~\\&',
    'Yardi',
    facilityId,
    'EyeWatchLive',
    'EyeWatchLive',
    hl7DateTime,
    '',
    `ADT^${trigger}`,
    messageControlId,
    'P',
    '2.5',
  ].join('|');
  const evn = ['EVN', trigger, hl7DateTime].join('|');
  const pid = [
    'PID',
    '1',
    '',
    String(input.residentId).trim(),
    '',
    `${lastName}^${firstName}^`,
    '',
    formatPidDate(input.dateOfBirth),
    (input.gender ?? '').trim(),
  ].join('|');
  const pv1 = ['PV1', '1', 'I^Current', `AZone1^${input.roomNumber.trim()}^Single^${facilityId}`].join(
    '|',
  );
  return [msh, evn, pid, pv1].join('\r');
}

export function remintYardiHl7MessageControlId(hl7: string): {
  hl7: string;
  messageControlId: string;
} {
  const messageControlId = mintYardiHl7MessageControlId();
  const segments = hl7.split(/\r\n|\n|\r/);
  const next = segments.map((segment) => {
    if (!segment.startsWith('MSH|')) return segment;
    const parts = segment.split('|');
    if (parts.length > 9) {
      parts[9] = messageControlId;
    }
    return parts.join('|');
  });
  const joiner = hl7.includes('\r\n') ? '\r\n' : hl7.includes('\r') ? '\r' : '\n';
  return { hl7: next.join(joiner), messageControlId };
}

export function extractYardiHl7FromEventPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const notification =
    record.notificationData && typeof record.notificationData === 'object'
      ? (record.notificationData as Record<string, unknown>)
      : undefined;
  const fromNotification = notification?.Message;
  if (typeof fromNotification === 'string' && fromNotification.startsWith('MSH|')) {
    return fromNotification;
  }
  const raw = record.raw && typeof record.raw === 'object' ? (record.raw as Record<string, unknown>) : undefined;
  const fromRaw = raw?.message;
  if (typeof fromRaw === 'string' && fromRaw.startsWith('MSH|')) {
    return fromRaw;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx jest --runInBand tests/integrations/yardi/yardiHl7TestMessage.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7TestMessage.ts tests/integrations/yardi/yardiHl7TestMessage.test.ts
git commit -m "$(cat <<'EOF'
feat: add Yardi HL7 test message builder and remint

EOF
)"
```

---

### Task 2: Caspio write recorder

**Files:**
- Create: `src/integrations/caspio/caspioWriteRecorder.ts`
- Create: `tests/integrations/caspio/caspioWriteRecorder.test.ts`
- Modify: `src/integrations/caspio/caspioClient.ts` (`upsertByFields` at the start of the function; `updateRecordById` at the start of the function)

**Interfaces:**
- Consumes: none
- Produces:
  - `CaspioRecordedOperation = { table: string; action: 'upsert' | 'update'; fields?: unknown; record?: unknown; id?: string | number }`
  - `runWithCaspioWriteRecorder<T>(options: { dryRun: boolean }, fn: () => Promise<T>): Promise<{ result: T; operations: CaspioRecordedOperation[] }>`
  - `noteCaspioWrite(operation: CaspioRecordedOperation): 'passthrough' | 'block'` — used only inside `caspioClient.ts`

`upsertOffPremEpisodeByEpisodeId` already calls `upsertByFields`, so intercepting those two leaves is enough. Do not also wrap `upsertOffPremEpisodeByEpisodeId` (that would double-count).

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/caspio/caspioWriteRecorder.test.ts`:

```ts
jest.mock('../../../src/config/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  runWithCaspioWriteRecorder,
} from '../../../src/integrations/caspio/caspioWriteRecorder.js';
import { noteCaspioWrite } from '../../../src/integrations/caspio/caspioWriteRecorder.js';

describe('caspioWriteRecorder', () => {
  it('blocks writes in dry-run and records the operation', async () => {
    const { operations } = await runWithCaspioWriteRecorder({ dryRun: true }, async () => {
      expect(
        noteCaspioWrite({
          table: 'CarePatientTable_API',
          action: 'upsert',
          fields: [{ field: 'PatientNumber', value: '1' }],
          record: { First_Name: 'Test' },
        }),
      ).toBe('block');
    });
    expect(operations).toEqual([
      {
        table: 'CarePatientTable_API',
        action: 'upsert',
        fields: [{ field: 'PatientNumber', value: '1' }],
        record: { First_Name: 'Test' },
      },
    ]);
  });

  it('passes through and still records in live mode', async () => {
    const { operations } = await runWithCaspioWriteRecorder({ dryRun: false }, async () => {
      expect(
        noteCaspioWrite({
          table: 'CarePatientTable_API',
          action: 'update',
          id: '9',
          record: { RoomNumber: '141' },
        }),
      ).toBe('passthrough');
    });
    expect(operations).toHaveLength(1);
    expect(operations[0]?.action).toBe('update');
  });

  it('passes through when no recorder is active', () => {
    expect(
      noteCaspioWrite({
        table: 'CarePatientTable_API',
        action: 'upsert',
        record: {},
      }),
    ).toBe('passthrough');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/integrations/caspio/caspioWriteRecorder.test.ts`

Expected: FAIL with `Cannot find module` for `caspioWriteRecorder.js`

- [ ] **Step 3: Write minimal implementation**

Create `src/integrations/caspio/caspioWriteRecorder.ts`:

```ts
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

export async function runWithCaspioWriteRecorder<T>(
  options: { dryRun: boolean },
  fn: () => Promise<T>,
): Promise<{ result: T; operations: CaspioRecordedOperation[] }> {
  const store: RecorderStore = { dryRun: options.dryRun, operations: [] };
  const result = await storage.run(store, fn);
  return { result, operations: store.operations };
}

export function noteCaspioWrite(operation: CaspioRecordedOperation): 'passthrough' | 'block' {
  const store = storage.getStore();
  if (!store) return 'passthrough';
  store.operations.push(operation);
  return store.dryRun ? 'block' : 'passthrough';
}
```

At the top of `upsertByFields` in `src/integrations/caspio/caspioClient.ts` (after the function signature, before `findRecordByFields`), add:

```ts
  const writeDecision = noteCaspioWrite({
    table: tableName,
    action: 'upsert',
    fields: filters,
    record,
  });
  if (writeDecision === 'block') {
    return { action: 'insert', id: 'dry-run' };
  }
```

Add the import at the top of `caspioClient.ts`:

```ts
import { noteCaspioWrite } from './caspioWriteRecorder.js';
```

At the start of `updateRecordById`, before `caspioRequestWithRetry`:

```ts
  const writeDecision = noteCaspioWrite({
    table: tableName,
    action: 'update',
    id,
    record,
  });
  if (writeDecision === 'block') {
    return {
      data: { dryRun: true },
      status: 200,
      statusText: 'DRY_RUN',
      headers: {},
      config: {} as never,
    };
  }
```

`updateRecordById` currently returns `Promise<AxiosResponse>`. The dry-run stub must satisfy that type. If TypeScript complains about the stub, cast the return as `AxiosResponse`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```
npx jest --runInBand tests/integrations/caspio/caspioWriteRecorder.test.ts tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts tests/integrations/caspio/caspioClient.test.ts
```

Expected: PASS. Orchestrator tests still mock `caspioClient.js`, so they do not hit the recorder.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/caspio/caspioWriteRecorder.ts src/integrations/caspio/caspioClient.ts tests/integrations/caspio/caspioWriteRecorder.test.ts
git commit -m "$(cat <<'EOF'
feat: intercept Caspio writes for HL7 dry-run

EOF
)"
```

---

### Task 3: Export `processAlisEventJob`

**Files:**
- Modify: `src/workers/processAlisEvent.ts` (the `processJob` function)
- Modify: `tests/workers/processAlisEvent.test.ts` (add one direct-call test; keep existing worker tests)

**Interfaces:**
- Consumes: existing `processJob` body; `ProcessAlisEventJobData` from `src/workers/types.ts`
- Produces: `export async function processAlisEventJob(data: ProcessAlisEventJobData): Promise<void>`

- [ ] **Step 1: Write the failing test**

Add to `tests/workers/processAlisEvent.test.ts` (keep existing mocks). Change the import to also pull `processAlisEventJob`, and add:

```ts
import { processAlisEventJob, startProcessAlisEventWorker } from '../../src/workers/processAlisEvent.js';

it('exports processAlisEventJob for inline admin runs', async () => {
  handleEhrEventMock.mockResolvedValue(undefined);
  await processAlisEventJob({
    source: 'alis',
    eventMessageId: 'evt-inline',
    eventType: 'residents.move_in',
    companyKey: 'appstoresandbox',
    companyId: 10,
    communityId: 113,
    notificationData: { ResidentId: 70508 },
    eventMessageDate: '2026-04-28T12:00:00Z',
  });
  expect(handleEhrEventMock).toHaveBeenCalled();
  expect(markEventProcessedMock).toHaveBeenCalledWith({
    companyId: 10,
    eventType: 'residents.move_in',
    eventMessageId: 'evt-inline',
    source: 'alis',
  });
});
```

Update `resolveResidentIdMock` / `fetchResidentBundleMock` in this test if they are still wired to the contact-event fixture from `beforeEach`. Override in the test:

```ts
  requiresResidentFetchMock.mockReturnValue(true);
  resolveResidentIdMock.mockReturnValue(70508);
  fetchResidentBundleMock.mockResolvedValue({
    event: {
      source: 'alis',
      companyKey: 'appstoresandbox',
      communityId: 113,
      eventType: 'residents.move_in',
      eventMessageId: 'evt-inline',
      eventMessageDate: '2026-04-28T12:00:00Z',
      lifecycleKind: 'move_in',
      notificationData: { ResidentId: 70508 },
      raw: {},
    },
    demographics: { externalResidentId: '70508', status: 'CurrentResident' },
    vendorPayload: {},
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/workers/processAlisEvent.test.ts -t "exports processAlisEventJob"`

Expected: FAIL with `processAlisEventJob` is not exported

- [ ] **Step 3: Write minimal implementation**

In `src/workers/processAlisEvent.ts`, replace `async function processJob(job: Job<ProcessAlisEventJobData>)` with:

```ts
export async function processAlisEventJob(data: ProcessAlisEventJobData): Promise<void> {
```

and change every `job.data` reference inside that function to `data`. Keep the destructure at the top:

```ts
  const {
    source,
    eventMessageId,
    eventType,
    companyKey,
    companyId,
    communityId,
    notificationData,
    eventMessageDate,
  } = data;
```

Then add:

```ts
async function processJob(job: Job<ProcessAlisEventJobData>): Promise<void> {
  await processAlisEventJob(job.data);
}
```

The `Worker` callback stays `async (job) => processJob(job)`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx jest --runInBand tests/workers/processAlisEvent.test.ts`

Expected: PASS (existing worker tests plus the new export test)

- [ ] **Step 5: Commit**

```bash
git add src/workers/processAlisEvent.ts tests/workers/processAlisEvent.test.ts
git commit -m "$(cat <<'EOF'
refactor: export processAlisEventJob for inline HL7 tests

EOF
)"
```

---

### Task 4: `runYardiHl7Test` runner

**Files:**
- Create: `src/admin/yardiHl7Test.ts`
- Create: `tests/admin/yardiHl7Test.test.ts`

**Interfaces:**
- Consumes:
  - `buildYardiHl7Adt`, `remintYardiHl7MessageControlId`, `extractYardiHl7FromEventPayload` from Task 1
  - `runWithCaspioWriteRecorder` from Task 2
  - `processAlisEventJob` from Task 3
  - `YardiHl7AdtAdapter`, `recordIncomingEvent`, `markEventIgnored`, `markEventQueued`
  - `getConfiguredYardiHl7PollTargets`, `resolveYardiHl7Facility`
  - `isSupportedYardiHl7EventType`, `SUPPORTED_YARDI_HL7_TRIGGERS`
  - `processAlisEventQueue.add`
  - `getCommunityEnrichment`
  - `prisma.eventLog.findUnique` / `findFirst` and `prisma.eventProcessingIssue.findMany`
- Produces:
  - `export class YardiHl7TestValidationError extends Error { readonly statusCode = 400 }`
  - `export type YardiHl7TestMode = 'inline' | 'dry-run' | 'enqueue'`
  - `export type YardiHl7TestSource = 'form' | 'hl7' | 'eventLog'`
  - `export type YardiHl7SkipReason = null | 'dry_run' | 'unknown_facility' | 'unsupported_trigger' | 'ehr_adapter_disabled' | 'ehr_community_not_enabled' | 'ehr_shadow_mode' | 'missing_cuid'`
  - `export type YardiHl7TestInput` — see implementation below
  - `export type YardiHl7TestResult` — see implementation below
  - `export function getYardiHl7TestConfig(): YardiHl7TestConfig`
  - `export async function runYardiHl7Test(input: YardiHl7TestInput): Promise<YardiHl7TestResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/admin/yardiHl7Test.test.ts`:

```ts
const recordIncomingEventMock = jest.fn();
const markEventIgnoredMock = jest.fn();
const markEventQueuedMock = jest.fn();
const processAlisEventJobMock = jest.fn();
const queueAddMock = jest.fn();
const getCommunityEnrichmentMock = jest.fn();
const eventLogFindFirstMock = jest.fn();
const eventLogFindUniqueMock = jest.fn();
const issueFindManyMock = jest.fn();
const resolveYardiHl7FacilityMock = jest.fn();
const getConfiguredYardiHl7PollTargetsMock = jest.fn();

jest.mock('../../src/config/env.js', () => ({
  env: {
    YARDI_HL7_POLL_ENABLED: true,
    YARDI_HL7_POLL_INTERVAL_MS: 300000,
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    EHR_ADAPTER_ENABLED: true,
    EHR_SHADOW_MODE: false,
    ehrEnabledCommunityIds: [],
  },
}));

jest.mock('../../src/domains/events.js', () => ({
  recordIncomingEvent: (...args: unknown[]) => recordIncomingEventMock(...args),
  markEventIgnored: (...args: unknown[]) => markEventIgnoredMock(...args),
  markEventQueued: (...args: unknown[]) => markEventQueuedMock(...args),
}));

jest.mock('../../src/workers/processAlisEvent.js', () => ({
  processAlisEventJob: (...args: unknown[]) => processAlisEventJobMock(...args),
}));

jest.mock('../../src/workers/queue.js', () => ({
  processAlisEventQueue: { add: (...args: unknown[]) => queueAddMock(...args) },
}));

jest.mock('../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: (...args: unknown[]) => getCommunityEnrichmentMock(...args),
}));

jest.mock('../../src/integrations/yardi/yardiHl7PollConfig.js', () => ({
  getConfiguredYardiHl7PollTargets: () => getConfiguredYardiHl7PollTargetsMock(),
  resolveYardiHl7Facility: (...args: unknown[]) => resolveYardiHl7FacilityMock(...args),
}));

jest.mock('../../src/db/prisma.js', () => ({
  prisma: {
    eventLog: {
      findFirst: (...args: unknown[]) => eventLogFindFirstMock(...args),
      findUnique: (...args: unknown[]) => eventLogFindUniqueMock(...args),
    },
    eventProcessingIssue: {
      findMany: (...args: unknown[]) => issueFindManyMock(...args),
    },
  },
}));

import { YardiHl7TestValidationError, runYardiHl7Test } from '../../src/admin/yardiHl7Test.js';

const SAMPLE_HL7 = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

function mockPersistedEvent(eventMessageId: string) {
  const eventLog = {
    id: 99,
    eventMessageId,
    eventType: 'hl7.adt.a01',
    status: 'received',
    communityId: 113,
    error: null,
    payload: {},
  };
  recordIncomingEventMock.mockResolvedValue({
    eventLog,
    company: { id: 10, companyKey: 'yourlife' },
    isDuplicate: false,
  });
  eventLogFindUniqueMock.mockResolvedValue({
    ...eventLog,
    status: 'processed',
    company: { companyKey: 'yourlife' },
  });
  issueFindManyMock.mockResolvedValue([]);
  getCommunityEnrichmentMock.mockResolvedValue({
    CUID: 'cuid-141',
    CommunityName: 'EyeWatch Live',
  });
}

describe('runYardiHl7Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConfiguredYardiHl7PollTargetsMock.mockReturnValue([
      { companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' },
    ]);
    resolveYardiHl7FacilityMock.mockReturnValue({
      companyKey: 'yourlife',
      communityId: 113,
      facilityId: 'EYELIVE',
    });
    processAlisEventJobMock.mockResolvedValue(undefined);
    markEventIgnoredMock.mockResolvedValue(undefined);
    markEventQueuedMock.mockResolvedValue(undefined);
    queueAddMock.mockResolvedValue({ id: 'job-1' });
  });

  it('rejects form trigger that is not supported', async () => {
    await expect(
      runYardiHl7Test({
        mode: 'inline',
        source: 'form',
        trigger: 'A11',
        residentId: '1',
        roomNumber: '141',
        facilityId: 'EYELIVE',
      }),
    ).rejects.toBeInstanceOf(YardiHl7TestValidationError);
    expect(recordIncomingEventMock).not.toHaveBeenCalled();
  });

  it('rejects dry-run plus enqueue', async () => {
    await expect(
      runYardiHl7Test({
        mode: 'dry-run',
        source: 'hl7',
        hl7: SAMPLE_HL7,
        enqueue: true,
      }),
    ).rejects.toBeInstanceOf(YardiHl7TestValidationError);
    expect(recordIncomingEventMock).not.toHaveBeenCalled();
  });

  it('rejects eventLog replay for non yardi-hl7 rows', async () => {
    eventLogFindFirstMock.mockResolvedValue({
      id: 1,
      source: 'alis',
      payload: { notificationData: { Message: SAMPLE_HL7 } },
    });
    await expect(
      runYardiHl7Test({ mode: 'inline', source: 'eventLog', eventLogId: 1 }),
    ).rejects.toBeInstanceOf(YardiHl7TestValidationError);
    expect(recordIncomingEventMock).not.toHaveBeenCalled();
  });

  it('runs inline form A01 through processAlisEventJob with a new message id', async () => {
    mockPersistedEvent('Tplaceholder');
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string }) => {
      mockPersistedEvent(event.eventMessageId);
      return {
        eventLog: { id: 99, eventMessageId: event.eventMessageId, eventType: event.eventType ?? 'hl7.adt.a01', status: 'received', communityId: 113, error: null, payload: {} },
        company: { id: 10, companyKey: 'yourlife' },
        isDuplicate: false,
      };
    });
    const result = await runYardiHl7Test({
      mode: 'inline',
      source: 'form',
      trigger: 'A01',
      residentId: '418612',
      roomNumber: '141',
      facilityId: 'EYELIVE',
    });
    expect(result.success).toBe(true);
    expect(result.event.eventMessageId).not.toBe('10529');
    expect(processAlisEventJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        eventType: 'hl7.adt.a01',
        companyKey: 'yourlife',
        communityId: 113,
      }),
    );
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('marks dry-run ignored and does not enqueue', async () => {
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
      eventLog: {
        id: 99,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: 'received',
        communityId: 113,
        error: null,
        payload: {},
      },
      company: { id: 10, companyKey: 'yourlife' },
      isDuplicate: false,
    }));
    eventLogFindUniqueMock.mockImplementation(async () => ({
      id: 99,
      eventMessageId: 'x',
      eventType: 'hl7.adt.a01',
      status: 'ignored',
      communityId: 113,
      error: 'dry_run',
      payload: {},
      company: { companyKey: 'yourlife' },
    }));
    issueFindManyMock.mockResolvedValue([]);
    getCommunityEnrichmentMock.mockResolvedValue({ CUID: 'cuid-141', CommunityName: 'EyeWatch Live' });

    const result = await runYardiHl7Test({
      mode: 'dry-run',
      source: 'hl7',
      hl7: SAMPLE_HL7,
    });
    expect(processAlisEventJobMock).toHaveBeenCalled();
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7' }),
      'dry_run',
    );
    expect(result.caspio.wrote).toBe(false);
    expect(result.caspio.skipReason).toBe('dry_run');
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('enqueues with the poller jobId shape', async () => {
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
      eventLog: {
        id: 99,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: 'queued',
        communityId: 113,
        error: null,
        payload: {},
      },
      company: { id: 10, companyKey: 'yourlife' },
      isDuplicate: false,
    }));
    eventLogFindUniqueMock.mockResolvedValue({
      id: 99,
      eventMessageId: 'x',
      eventType: 'hl7.adt.a01',
      status: 'queued',
      communityId: 113,
      error: null,
      payload: {},
      company: { companyKey: 'yourlife' },
    });
    issueFindManyMock.mockResolvedValue([]);
    getCommunityEnrichmentMock.mockResolvedValue({ CUID: 'cuid-141' });

    const result = await runYardiHl7Test({
      mode: 'enqueue',
      source: 'hl7',
      hl7: SAMPLE_HL7,
    });
    expect(processAlisEventJobMock).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledWith(
      'process-alis-event',
      expect.objectContaining({ source: 'yardi-hl7', eventType: 'hl7.adt.a01' }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^event-yardi-hl7-hl7\.adt\.a01-/),
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
    expect(result.jobId).toBe('job-1');
    expect(result.caspio.operations).toEqual([]);
    expect(result.caspio.wrote).toBe(false);
  });

  it('ignores unknown facility without calling the worker', async () => {
    resolveYardiHl7FacilityMock.mockReturnValue(null);
    recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
      eventLog: {
        id: 99,
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        status: 'ignored',
        communityId: null,
        error: 'unknown_facility',
        payload: {},
      },
      company: { id: 10, companyKey: 'yardi' },
      isDuplicate: false,
    }));
    eventLogFindUniqueMock.mockResolvedValue({
      id: 99,
      eventMessageId: 'x',
      eventType: 'hl7.adt.a01',
      status: 'ignored',
      communityId: null,
      error: 'unknown_facility',
      payload: {},
      company: { companyKey: 'yardi' },
    });
    issueFindManyMock.mockResolvedValue([]);

    const result = await runYardiHl7Test({
      mode: 'inline',
      source: 'hl7',
      hl7: SAMPLE_HL7,
    });
    expect(markEventIgnoredMock).toHaveBeenCalledWith(expect.anything(), 'unknown_facility');
    expect(processAlisEventJobMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.caspio.skipReason).toBe('unknown_facility');
  });
});
```

Mode encoding: the runner input uses `mode: 'inline' | 'dry-run' | 'enqueue'` only. Do **not** add a separate `enqueue` boolean on the public type. The dry-run+enqueue test above should use an invalid combination the parser rejects — if the type does not allow both, the HTTP layer (Task 5) rejects `dryRun: true` + `enqueue: true` query/body flags before calling the runner. In this task, reject when `input.mode` is not one of the three strings, and when callers pass `mode: 'dry-run'` with a truthy extra `enqueue` field:

```ts
export type YardiHl7TestInput = {
  mode?: YardiHl7TestMode;
  source: YardiHl7TestSource;
  enqueue?: boolean;
  trigger?: string;
  residentId?: string;
  roomNumber?: string;
  facilityId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  hl7?: string;
  eventLogId?: number;
  eventMessageId?: string;
};
```

Reject when `(input.mode === 'dry-run' && input.enqueue) || (input.mode === 'enqueue' && input.mode === 'dry-run')` — practically: if `enqueue === true` and (`mode === 'dry-run'` or dry-run implied). Implementation: `const mode = input.mode ?? 'inline'; if (mode === 'dry-run' && input.enqueue) throw validation`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/admin/yardiHl7Test.test.ts`

Expected: FAIL with `Cannot find module` for `yardiHl7Test.js`

- [ ] **Step 3: Write minimal implementation**

Create `src/admin/yardiHl7Test.ts`:

```ts
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { markEventIgnored, markEventQueued, recordIncomingEvent } from '../domains/events.js';
import { YardiHl7AdtAdapter } from '../integrations/ehr/yardiHl7AdtAdapter.js';
import { getCommunityEnrichment } from '../integrations/caspio/caspioCommunityEnrichment.js';
import { runWithCaspioWriteRecorder } from '../integrations/caspio/caspioWriteRecorder.js';
import type { CaspioRecordedOperation } from '../integrations/caspio/caspioWriteRecorder.js';
import {
  getConfiguredYardiHl7PollTargets,
  resolveYardiHl7Facility,
} from '../integrations/yardi/yardiHl7PollConfig.js';
import {
  isSupportedYardiHl7EventType,
  isSupportedYardiHl7Trigger,
  SUPPORTED_YARDI_HL7_TRIGGERS,
} from '../integrations/yardi/yardiHl7Triggers.js';
import {
  buildYardiHl7Adt,
  extractYardiHl7FromEventPayload,
  remintYardiHl7MessageControlId,
} from '../integrations/yardi/yardiHl7TestMessage.js';
import { processAlisEventJob } from '../workers/processAlisEvent.js';
import { processAlisEventQueue } from '../workers/queue.js';
import type { ProcessAlisEventJobData } from '../workers/types.js';

export class YardiHl7TestValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'YardiHl7TestValidationError';
  }
}

export type YardiHl7TestMode = 'inline' | 'dry-run' | 'enqueue';
export type YardiHl7TestSource = 'form' | 'hl7' | 'eventLog';
export type YardiHl7SkipReason =
  | null
  | 'dry_run'
  | 'unknown_facility'
  | 'unsupported_trigger'
  | 'ehr_adapter_disabled'
  | 'ehr_community_not_enabled'
  | 'ehr_shadow_mode'
  | 'missing_cuid';

export type YardiHl7TestConfig = {
  pollEnabled: boolean;
  pollIntervalMs: number;
  targets: ReturnType<typeof getConfiguredYardiHl7PollTargets>;
  supportedTriggers: string[];
  caspioPatientTable: string;
  caspioCommunityTable: string;
  caspioServiceTable: string;
  ehrAdapterEnabled: boolean;
  ehrShadowMode: boolean;
  ehrEnabledCommunityIds: number[];
};

export type YardiHl7TestInput = {
  mode?: YardiHl7TestMode;
  source: YardiHl7TestSource;
  enqueue?: boolean;
  trigger?: string;
  residentId?: string;
  roomNumber?: string;
  facilityId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  hl7?: string;
  eventLogId?: number;
  eventMessageId?: string;
};

export type YardiHl7TestResult = {
  success: boolean;
  mode: YardiHl7TestMode;
  event: {
    id: number;
    eventMessageId: string;
    eventType: string;
    status: string;
    companyKey: string;
    communityId: number | null;
  };
  parsed: {
    trigger: string;
    residentId: string | null;
    roomNumber: string | null;
    facilityId: string | null;
  };
  enrichment: { CUID?: string; communityName?: string };
  caspio: {
    wrote: boolean;
    skipReason: YardiHl7SkipReason;
    operations: CaspioRecordedOperation[];
  };
  issues: Array<{ stage: string; severity: string; message: string }>;
  hl7: string;
  jobId: string | null;
};

export function getYardiHl7TestConfig(): YardiHl7TestConfig {
  return {
    pollEnabled: env.YARDI_HL7_POLL_ENABLED,
    pollIntervalMs: env.YARDI_HL7_POLL_INTERVAL_MS,
    targets: getConfiguredYardiHl7PollTargets(),
    supportedTriggers: [...SUPPORTED_YARDI_HL7_TRIGGERS],
    caspioPatientTable: env.CASPIO_TABLE_NAME,
    caspioCommunityTable: env.CASPIO_COMMUNITY_TABLE_NAME,
    caspioServiceTable: env.CASPIO_SERVICE_TABLE_NAME,
    ehrAdapterEnabled: env.EHR_ADAPTER_ENABLED,
    ehrShadowMode: env.EHR_SHADOW_MODE,
    ehrEnabledCommunityIds: env.ehrEnabledCommunityIds,
  };
}

function resolveMode(input: YardiHl7TestInput): YardiHl7TestMode {
  const mode = input.mode ?? 'inline';
  if (mode !== 'inline' && mode !== 'dry-run' && mode !== 'enqueue') {
    throw new YardiHl7TestValidationError('mode must be inline, dry-run, or enqueue');
  }
  if (mode === 'dry-run' && input.enqueue) {
    throw new YardiHl7TestValidationError('dry-run cannot be combined with enqueue');
  }
  if (input.enqueue && mode === 'inline') {
    return 'enqueue';
  }
  return mode;
}

async function resolveHl7(input: YardiHl7TestInput): Promise<string> {
  if (input.source === 'form') {
    const trigger = (input.trigger ?? '').trim().toUpperCase();
    if (!isSupportedYardiHl7Trigger(trigger)) {
      throw new YardiHl7TestValidationError('form trigger must be a supported ADT code');
    }
    const residentId = (input.residentId ?? '').trim();
    const roomNumber = (input.roomNumber ?? '').trim();
    if (!residentId || !roomNumber) {
      throw new YardiHl7TestValidationError('form source requires residentId and roomNumber');
    }
    const targets = getConfiguredYardiHl7PollTargets();
    let facilityId = (input.facilityId ?? '').trim();
    if (!facilityId && targets.length === 1) {
      facilityId = targets[0]!.facilityId;
    }
    if (!facilityId) {
      throw new YardiHl7TestValidationError('form source requires facilityId');
    }
    return buildYardiHl7Adt({
      trigger,
      residentId,
      roomNumber,
      facilityId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
    });
  }
  if (input.source === 'hl7') {
    const hl7 = (input.hl7 ?? '').trim();
    if (!hl7.startsWith('MSH|')) {
      throw new YardiHl7TestValidationError('hl7 source requires a message starting with MSH|');
    }
    return hl7;
  }
  if (input.source === 'eventLog') {
    const row = input.eventLogId
      ? await prisma.eventLog.findFirst({ where: { id: input.eventLogId } })
      : input.eventMessageId
        ? await prisma.eventLog.findFirst({ where: { eventMessageId: input.eventMessageId } })
        : null;
    if (!row) {
      throw new YardiHl7TestValidationError('EventLog row not found');
    }
    if (row.source !== 'yardi-hl7') {
      throw new YardiHl7TestValidationError('EventLog replay is only supported for yardi-hl7');
    }
    const extracted = extractYardiHl7FromEventPayload(row.payload);
    if (!extracted) {
      throw new YardiHl7TestValidationError('EventLog row has no extractable HL7 Message');
    }
    return extracted;
  }
  throw new YardiHl7TestValidationError('source must be form, hl7, or eventLog');
}

function skipReasonForGates(communityId: number | null): YardiHl7SkipReason {
  if (!env.EHR_ADAPTER_ENABLED) return 'ehr_adapter_disabled';
  if (
    env.ehrEnabledCommunityIds.length > 0 &&
    (communityId === null || !env.ehrEnabledCommunityIds.includes(communityId))
  ) {
    return 'ehr_community_not_enabled';
  }
  if (env.EHR_SHADOW_MODE) return 'ehr_shadow_mode';
  return null;
}

export async function runYardiHl7Test(input: YardiHl7TestInput): Promise<YardiHl7TestResult> {
  const mode = resolveMode(input);
  const rawHl7 = await resolveHl7(input);
  const reminted = remintYardiHl7MessageControlId(rawHl7);
  const adapter = new YardiHl7AdtAdapter();
  const event = adapter.parseInboundEvent(reminted.hl7);
  event.notificationData.Message = reminted.hl7;

  const sendingFacility =
    typeof event.notificationData.SendingFacility === 'string'
      ? event.notificationData.SendingFacility
      : null;
  const pv1Facility =
    typeof event.notificationData.Pv1Facility === 'string' ? event.notificationData.Pv1Facility : null;
  const facilityId = sendingFacility?.trim() || pv1Facility;
  const target = resolveYardiHl7Facility(facilityId, getConfiguredYardiHl7PollTargets());
  if (target) {
    event.companyKey = target.companyKey;
    event.communityId = target.communityId;
  }

  const recorded = await recordIncomingEvent(event);
  const identity = {
    companyId: recorded.company.id,
    eventType: event.eventType,
    eventMessageId: event.eventMessageId,
    source: event.source,
  };
  const job: ProcessAlisEventJobData = {
    source: event.source,
    eventMessageId: event.eventMessageId,
    eventType: event.eventType,
    companyKey: event.companyKey,
    companyId: recorded.company.id,
    communityId: event.communityId,
    notificationData: event.notificationData,
    eventMessageDate: event.eventMessageDate,
  };

  let operations: CaspioRecordedOperation[] = [];
  let skipReason: YardiHl7SkipReason = null;
  let jobId: string | null = null;
  let success = true;

  if (!target) {
    await markEventIgnored(identity, 'unknown_facility');
    skipReason = 'unknown_facility';
    success = false;
  } else if (!isSupportedYardiHl7EventType(event.eventType)) {
    await markEventIgnored(identity, 'unsupported_trigger');
    skipReason = 'unsupported_trigger';
    success = false;
  } else if (mode === 'enqueue') {
    const added = await processAlisEventQueue.add('process-alis-event', job, {
      jobId: `event-yardi-hl7-${job.eventType}-${job.eventMessageId}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
    await markEventQueued(identity);
    jobId = added.id ? String(added.id) : `event-yardi-hl7-${job.eventType}-${job.eventMessageId}`;
  } else {
    try {
      const recordedWrites = await runWithCaspioWriteRecorder(
        { dryRun: mode === 'dry-run' },
        async () => {
          await processAlisEventJob(job);
        },
      );
      operations = recordedWrites.operations;
      if (mode === 'dry-run') {
        await markEventIgnored(identity, 'dry_run');
        skipReason = 'dry_run';
      } else if (operations.length === 0) {
        const gate = skipReasonForGates(event.communityId ?? null);
        if (gate) skipReason = gate;
        const issues = await prisma.eventProcessingIssue.findMany({
          where: {
            companyId: recorded.company.id,
            eventMessageId: event.eventMessageId,
          },
        });
        if (issues.some((issue) => /cuid/i.test(issue.message))) {
          skipReason = 'missing_cuid';
        }
      }
    } catch (error) {
      success = false;
      if (mode === 'dry-run') {
        skipReason = 'dry_run';
      }
      throw error;
    }
  }

  const roomNumber =
    typeof event.notificationData.RoomNumber === 'string' ? event.notificationData.RoomNumber : null;
  let enrichment: { CUID?: string; communityName?: string } = {};
  if (event.communityId != null) {
    try {
      const row = await getCommunityEnrichment(event.communityId, roomNumber ?? undefined);
      enrichment = { CUID: row.CUID, communityName: row.CommunityName };
    } catch {
      enrichment = {};
    }
  }

  const reloaded = await prisma.eventLog.findUnique({
    where: {
      companyId_source_eventType_eventMessageId: {
        companyId: recorded.company.id,
        source: event.source,
        eventType: event.eventType,
        eventMessageId: event.eventMessageId,
      },
    },
    include: { company: { select: { companyKey: true } } },
  });
  const issues = await prisma.eventProcessingIssue.findMany({
    where: { companyId: recorded.company.id, eventMessageId: event.eventMessageId },
    orderBy: { createdAt: 'asc' },
  });

  if (reloaded?.status === 'failed') {
    success = false;
  }

  const wrote = mode === 'inline' && operations.length > 0 && skipReason === null;

  return {
    success,
    mode,
    event: {
      id: reloaded?.id ?? recorded.eventLog.id,
      eventMessageId: event.eventMessageId,
      eventType: event.eventType,
      status: reloaded?.status ?? recorded.eventLog.status,
      companyKey: reloaded?.company.companyKey ?? recorded.company.companyKey,
      communityId: reloaded?.communityId ?? event.communityId ?? null,
    },
    parsed: {
      trigger: String(event.notificationData.TriggerEvent ?? ''),
      residentId:
        event.notificationData.ResidentId === null || event.notificationData.ResidentId === undefined
          ? null
          : String(event.notificationData.ResidentId),
      roomNumber,
      facilityId: facilityId ?? null,
    },
    enrichment,
    caspio: {
      wrote,
      skipReason,
      operations: mode === 'enqueue' ? [] : operations,
    },
    issues: issues.map((issue) => ({
      stage: issue.stage,
      severity: issue.severity,
      message: issue.message,
    })),
    hl7: reminted.hl7,
    jobId,
  };
}
```

Do not catch-and-rethrow in a way that turns Caspio failures into 500 without a result. `processAlisEventJob` already marks the event `failed` and rethrows. The route (Task 5) should catch that, reload is not available — change the `catch` so Caspio failures still return a `YardiHl7TestResult` with `success: false` instead of throwing:

Replace the `catch` block with:

```ts
    } catch (error) {
      success = false;
      const reloadedFailed = await prisma.eventLog.findUnique({
        where: {
          companyId_source_eventType_eventMessageId: {
            companyId: recorded.company.id,
            source: event.source,
            eventType: event.eventType,
            eventMessageId: event.eventMessageId,
          },
        },
        include: { company: { select: { companyKey: true } } },
      });
      const failedIssues = await prisma.eventProcessingIssue.findMany({
        where: { companyId: recorded.company.id, eventMessageId: event.eventMessageId },
      });
      return {
        success: false,
        mode,
        event: {
          id: reloadedFailed?.id ?? recorded.eventLog.id,
          eventMessageId: event.eventMessageId,
          eventType: event.eventType,
          status: reloadedFailed?.status ?? 'failed',
          companyKey: reloadedFailed?.company.companyKey ?? recorded.company.companyKey,
          communityId: reloadedFailed?.communityId ?? event.communityId ?? null,
        },
        parsed: {
          trigger: String(event.notificationData.TriggerEvent ?? ''),
          residentId:
            event.notificationData.ResidentId == null
              ? null
              : String(event.notificationData.ResidentId),
          roomNumber:
            typeof event.notificationData.RoomNumber === 'string'
              ? event.notificationData.RoomNumber
              : null,
          facilityId: facilityId ?? null,
        },
        enrichment: {},
        caspio: { wrote: false, skipReason: mode === 'dry-run' ? 'dry_run' : null, operations },
        issues: failedIssues.map((issue) => ({
          stage: issue.stage,
          severity: issue.severity,
          message: issue.message,
        })),
        hl7: reminted.hl7,
        jobId: null,
      };
    }
```

That avoids a second code path in the route for expected Caspio errors.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx jest --runInBand tests/admin/yardiHl7Test.test.ts`

Expected: PASS

If `recordIncomingEvent` mock typing on `event.eventType` fails, use `as any` on the mock implementation argument only.

- [ ] **Step 5: Commit**

```bash
git add src/admin/yardiHl7Test.ts tests/admin/yardiHl7Test.test.ts
git commit -m "$(cat <<'EOF'
feat: add Yardi HL7 workflow test runner

EOF
)"
```

---

### Task 5: Admin HTTP routes

**Files:**
- Modify: `src/http/routes.ts` (imports; add three routes next to the existing `/admin/yardi-fhir-test` routes around line 63 and 743)
- Create: `tests/http/yardiHl7Test.routes.test.ts`

**Interfaces:**
- Consumes: `getYardiHl7TestConfig`, `runYardiHl7Test`, `YardiHl7TestValidationError` from Task 4
- Produces:
  - `GET /admin/yardi-hl7-test` → redirect `/public/yardi-hl7-test.html` (page file is Task 6; redirect can land on a missing file until then)
  - `GET /admin/yardi-hl7-test/config`
  - `POST /admin/yardi-hl7-test/run`

- [ ] **Step 1: Write the failing test**

Create `tests/http/yardiHl7Test.routes.test.ts`:

```ts
import request from 'supertest';

const runYardiHl7TestMock = jest.fn();
const getYardiHl7TestConfigMock = jest.fn();

jest.mock('../../src/admin/yardiHl7Test.js', () => {
  class YardiHl7TestValidationError extends Error {
    statusCode = 400;
  }
  return {
    YardiHl7TestValidationError,
    runYardiHl7Test: (...args: unknown[]) => runYardiHl7TestMock(...args),
    getYardiHl7TestConfig: () => getYardiHl7TestConfigMock(),
  };
});

import { YardiHl7TestValidationError } from '../../src/admin/yardiHl7Test.js';
import { createApp } from '../../src/http/app.js';

const app = createApp();
const authHeader = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;

describe('Yardi HL7 test routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getYardiHl7TestConfigMock.mockReturnValue({
      pollEnabled: true,
      supportedTriggers: ['A01'],
      targets: [{ companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' }],
    });
  });

  it('requires admin auth on config', async () => {
    const response = await request(app).get('/admin/yardi-hl7-test/config');
    expect(response.status).toBe(401);
  });

  it('returns config', async () => {
    const response = await request(app)
      .get('/admin/yardi-hl7-test/config')
      .set('Authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.config.supportedTriggers).toEqual(['A01']);
  });

  it('returns 400 when the runner rejects the body', async () => {
    runYardiHl7TestMock.mockRejectedValueOnce(new YardiHl7TestValidationError('form trigger must be a supported ADT code'));
    const response = await request(app)
      .post('/admin/yardi-hl7-test/run')
      .set('Authorization', authHeader)
      .send({ source: 'form', trigger: 'A11', residentId: '1', roomNumber: '1' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('returns the runner result', async () => {
    runYardiHl7TestMock.mockResolvedValueOnce({
      success: true,
      mode: 'inline',
      event: { id: 1, eventMessageId: 'T1', eventType: 'hl7.adt.a01', status: 'processed', companyKey: 'yourlife', communityId: 113 },
      parsed: { trigger: 'A01', residentId: '418612', roomNumber: '141', facilityId: 'EYELIVE' },
      enrichment: { CUID: 'c' },
      caspio: { wrote: true, skipReason: null, operations: [] },
      issues: [],
      hl7: 'MSH|',
      jobId: null,
    });
    const response = await request(app)
      .post('/admin/yardi-hl7-test/run')
      .set('Authorization', authHeader)
      .send({ source: 'form', trigger: 'A01', residentId: '418612', roomNumber: '141' });
    expect(response.status).toBe(200);
    expect(response.body.event.eventType).toBe('hl7.adt.a01');
    expect(runYardiHl7TestMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'form', trigger: 'A01' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/http/yardiHl7Test.routes.test.ts`

Expected: FAIL (404 on the new paths)

- [ ] **Step 3: Write minimal implementation**

In `src/http/routes.ts`, add to the existing admin import block from `../admin/yardiFhirTest.js` a second import:

```ts
import {
  getYardiHl7TestConfig,
  runYardiHl7Test,
  YardiHl7TestValidationError,
} from '../admin/yardiHl7Test.js';
```

Next to the FHIR page redirect (around line 63):

```ts
router.get('/admin/yardi-hl7-test', authAdmin, (_req, res) => {
  res.redirect('/public/yardi-hl7-test.html');
});
```

Next to `/admin/yardi-fhir-test/config`:

```ts
router.get('/admin/yardi-hl7-test/config', authAdmin, (_req, res) => {
  try {
    return res.json({
      success: true,
      config: getYardiHl7TestConfig(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/admin/yardi-hl7-test/run', authAdmin, async (req, res) => {
  try {
    logger.info({ source: req.body?.source, mode: req.body?.mode }, 'admin_yardi_hl7_test_run_called');
    const result = await runYardiHl7Test(req.body ?? {});
    return res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof YardiHl7TestValidationError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
    logger.error({ error }, 'admin_yardi_hl7_test_run_failed');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx jest --runInBand tests/http/yardiHl7Test.routes.test.ts tests/http/webhook.test.ts tests/http/health.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/http/routes.ts tests/http/yardiHl7Test.routes.test.ts
git commit -m "$(cat <<'EOF'
feat: add admin routes for Yardi HL7 workflow tester

EOF
)"
```

---

### Task 6: Tester page

**Files:**
- Create: `public/yardi-hl7-test.html`

**Interfaces:**
- Consumes: `GET /admin/yardi-hl7-test/config`, `POST /admin/yardi-hl7-test/run`
- Produces: page with Build ADT / Paste HL7 / Replay EventLog, Dry-run and Enqueue checkboxes (mutually exclusive), live-run confirm dialog

- [ ] **Step 1: Create the page**

Create `public/yardi-hl7-test.html`. Copy the visual language from `public/yardi-fhir-test.html` (dark `#0d1117` / `#161b22`, `#58a6ff` headings). Required behavior:

1. On load, `GET /admin/yardi-hl7-test/config` with `credentials: 'same-origin'` (browser BasicAuth prompt) and fill:
   - facility `<select>` from `config.targets`
   - trigger `<select>` from `config.supportedTriggers`
   - show poll / Caspio table / gate flags as muted text
2. Three radio buttons: `form` | `hl7` | `eventLog`. Show only the matching fields.
3. Checkboxes `#dryRun` and `#enqueue`. If one is checked, uncheck the other (`change` listeners).
4. Submit `#runBtn`:
   - Build `mode`: `dry-run` if dry-run checked, else `enqueue` if enqueue checked, else `inline`
   - If mode is `inline`, `confirm()` with `trigger`, `residentId`, `room`, `facilityId` (from form fields or `"from HL7 / EventLog"`)
   - `POST /admin/yardi-hl7-test/run` with JSON body:
     - form: `{ mode, source: 'form', trigger, residentId, roomNumber, facilityId, firstName, lastName, dateOfBirth, gender }`
     - hl7: `{ mode, source: 'hl7', hl7 }`
     - eventLog: `{ mode, source: 'eventLog', eventLogId }` if the id field is numeric, otherwise `{ mode, source: 'eventLog', eventMessageId }`
5. Render the JSON result in `#result`: parsed fields, CUID, EventLog id/status, `caspio.operations`, issues, and `hl7`.
6. On 401, show “Admin BasicAuth required”.
7. Title: `Yardi HL7 Workflow Tester`. Subtitle: explains live write is default and this never ProcessACKs Yardi.

Use this script skeleton (complete it in the file; do not leave handlers empty):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yardi HL7 Workflow Tester</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    .container { max-width: 1100px; margin: 0 auto; }
    header, .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 16px; padding: 16px; }
    h1 { color: #58a6ff; font-size: 24px; margin-bottom: 8px; }
    .muted { color: #8b949e; font-size: 13px; }
    label { display: block; margin: 10px 0 6px; color: #8b949e; font-size: 12px; text-transform: uppercase; }
    input, select, textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 10px; border-radius: 6px; }
    textarea { min-height: 140px; font-family: Consolas, Monaco, monospace; font-size: 12px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .checks { display: flex; gap: 16px; margin: 12px 0; align-items: center; }
    .checks label { margin: 0; text-transform: none; color: #c9d1d9; }
    button { background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0d1117; padding: 12px; border-radius: 6px; font-size: 12px; }
    .error { background: rgba(248, 81, 73, 0.12); border: 1px solid rgba(248, 81, 73, 0.35); color: #f85149; padding: 10px; border-radius: 6px; margin-bottom: 12px; }
    a { color: #58a6ff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Yardi HL7 Workflow Tester</h1>
      <p class="muted">Fire a specific ADT through the same Caspio workflow as the poller. Live write is the default. This never ProcessACKs the Yardi mailbox. <a href="/monitor">Open monitor</a></p>
      <p class="muted" id="configFlags"></p>
    </header>
    <section class="card">
      <div class="checks">
        <label><input type="radio" name="source" value="form" checked> Build ADT</label>
        <label><input type="radio" name="source" value="hl7"> Paste HL7</label>
        <label><input type="radio" name="source" value="eventLog"> Replay EventLog</label>
      </div>
      <div id="formFields">
        <div class="row">
          <div><label>Trigger</label><select id="trigger"></select></div>
          <div><label>Facility</label><select id="facilityId"></select></div>
        </div>
        <div class="row">
          <div><label>Resident ID</label><input id="residentId" /></div>
          <div><label>Room</label><input id="roomNumber" /></div>
        </div>
        <div class="row">
          <div><label>First name</label><input id="firstName" placeholder="Test" /></div>
          <div><label>Last name</label><input id="lastName" placeholder="Resident" /></div>
        </div>
        <div class="row">
          <div><label>DOB</label><input id="dateOfBirth" placeholder="YYYY-MM-DD" /></div>
          <div><label>Gender</label><input id="gender" placeholder="F" /></div>
        </div>
      </div>
      <div id="hl7Fields" hidden>
        <label>Raw HL7</label>
        <textarea id="hl7"></textarea>
      </div>
      <div id="eventLogFields" hidden>
        <label>EventLog id or eventMessageId</label>
        <input id="eventLogRef" />
      </div>
      <div class="checks">
        <label><input type="checkbox" id="dryRun"> Dry-run</label>
        <label><input type="checkbox" id="enqueue"> Enqueue like the poller</label>
      </div>
      <button id="runBtn" type="button">Run</button>
    </section>
    <section class="card">
      <div id="error" class="error" hidden></div>
      <pre id="result">No run yet.</pre>
    </section>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    const sourceRadios = () => [...document.querySelectorAll('input[name="source"]')];

    function selectedSource() {
      return sourceRadios().find((el) => el.checked)?.value || 'form';
    }

    function showSource() {
      const source = selectedSource();
      $('formFields').hidden = source !== 'form';
      $('hl7Fields').hidden = source !== 'hl7';
      $('eventLogFields').hidden = source !== 'eventLog';
    }

    $('dryRun').addEventListener('change', () => {
      if ($('dryRun').checked) $('enqueue').checked = false;
    });
    $('enqueue').addEventListener('change', () => {
      if ($('enqueue').checked) $('dryRun').checked = false;
    });
    sourceRadios().forEach((el) => el.addEventListener('change', showSource));

    async function loadConfig() {
      const res = await fetch('/admin/yardi-hl7-test/config', { credentials: 'same-origin' });
      if (res.status === 401) {
        $('error').hidden = false;
        $('error').textContent = 'Admin BasicAuth required.';
        return;
      }
      const data = await res.json();
      const config = data.config || {};
      (config.supportedTriggers || []).forEach((code) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        $('trigger').appendChild(opt);
      });
      (config.targets || []).forEach((target) => {
        const opt = document.createElement('option');
        opt.value = target.facilityId;
        opt.textContent = `${target.facilityId} · ${target.companyKey} · ${target.communityId}`;
        $('facilityId').appendChild(opt);
      });
      $('configFlags').textContent = `Poll ${config.pollEnabled ? 'on' : 'off'} · patient ${config.caspioPatientTable} · adapter ${config.ehrAdapterEnabled} · shadow ${config.ehrShadowMode}`;
    }

    function currentMode() {
      if ($('dryRun').checked) return 'dry-run';
      if ($('enqueue').checked) return 'enqueue';
      return 'inline';
    }

    function buildBody() {
      const mode = currentMode();
      const source = selectedSource();
      if (source === 'form') {
        return {
          mode,
          source,
          trigger: $('trigger').value,
          residentId: $('residentId').value,
          roomNumber: $('roomNumber').value,
          facilityId: $('facilityId').value,
          firstName: $('firstName').value,
          lastName: $('lastName').value,
          dateOfBirth: $('dateOfBirth').value,
          gender: $('gender').value,
        };
      }
      if (source === 'hl7') {
        return { mode, source, hl7: $('hl7').value };
      }
      const ref = $('eventLogRef').value.trim();
      if (/^\d+$/.test(ref)) return { mode, source, eventLogId: Number(ref) };
      return { mode, source, eventMessageId: ref };
    }

    $('runBtn').addEventListener('click', async () => {
      $('error').hidden = true;
      const body = buildBody();
      if (body.mode === 'inline') {
        const ok = confirm(
          `Live Caspio write?\nTrigger: ${body.trigger || 'from HL7 / EventLog'}\nResident: ${body.residentId || 'from HL7 / EventLog'}\nRoom: ${body.roomNumber || 'from HL7 / EventLog'}\nFacility: ${body.facilityId || 'from HL7 / EventLog'}`,
        );
        if (!ok) return;
      }
      $('runBtn').disabled = true;
      try {
        const res = await fetch('/admin/yardi-hl7-test/run', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          $('error').hidden = false;
          $('error').textContent = data.error || res.statusText;
        }
        $('result').textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        $('error').hidden = false;
        $('error').textContent = error instanceof Error ? error.message : String(error);
      } finally {
        $('runBtn').disabled = false;
      }
    });

    showSource();
    loadConfig();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the page is served**

There is no Jest for this file. Confirm `src/http/app.ts` still mounts `public/` (it already does). Open `/admin/yardi-hl7-test` after `npm run dev` and check: facility dropdown fills, Dry-run unchecks Enqueue, confirm dialog appears only for live inline.

- [ ] **Step 3: Commit**

```bash
git add public/yardi-hl7-test.html
git commit -m "$(cat <<'EOF'
feat: add Yardi HL7 workflow tester page

EOF
)"
```

---

### Task 7: Monitor Dry-run / Replay

**Files:**
- Modify: `public/webhook-monitor.html` (header link; `renderEvents` actions; helper functions)

**Interfaces:**
- Consumes: `POST /admin/yardi-hl7-test/run` with `{ source: 'eventLog', eventLogId, mode }`
- Produces: Dry-run and Replay buttons on `yardi-hl7` rows that have extractable `MSH|` HL7

- [ ] **Step 1: Add extract + action helpers and buttons**

In `public/webhook-monitor.html` header (the `<h1>` block), add:

```html
<p style="margin-top: 8px;"><a href="/admin/yardi-hl7-test" style="color: #58a6ff;">HL7 workflow tester</a></p>
```

In the `<script>` section, add these functions next to `yardiHl7EventLabel`:

```js
        function extractMonitorHl7(event) {
            const payload = event && event.payload;
            if (!payload || typeof payload !== 'object') return '';
            const fromNotification = payload.notificationData && payload.notificationData.Message;
            if (typeof fromNotification === 'string' && fromNotification.indexOf('MSH|') === 0) {
                return fromNotification;
            }
            const fromRaw = payload.raw && payload.raw.message;
            if (typeof fromRaw === 'string' && fromRaw.indexOf('MSH|') === 0) {
                return fromRaw;
            }
            return '';
        }

        function authHeaderFromForm() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            return { 'Authorization': 'Basic ' + btoa(username + ':' + password), 'Content-Type': 'application/json' };
        }

        async function runMonitorReplay(eventId, mode) {
            const event = events.find((row) => row.id === eventId);
            if (!event) return;
            if (mode === 'inline') {
                const ok = confirm(
                    'Live Caspio write for this captured HL7?\n' +
                    'Type: ' + event.eventType + '\n' +
                    'Company: ' + event.companyKey + '\n' +
                    'Community: ' + (event.communityId || ''),
                );
                if (!ok) return;
            }
            const res = await fetch('/admin/yardi-hl7-test/run', {
                method: 'POST',
                headers: authHeaderFromForm(),
                body: JSON.stringify({ source: 'eventLog', eventLogId: event.id, mode: mode }),
            });
            const data = await res.json();
            alert((data.success ? 'OK ' : 'Failed ') + (data.event && data.event.eventMessageId ? data.event.eventMessageId : '') + ' — ' + (data.caspio && data.caspio.skipReason ? data.caspio.skipReason : data.error || data.event && data.event.status || res.status));
        }
```

In `renderEvents`, inside the `yardi-hl7` event-item template, after the status/meta row and before `<details>`, add buttons only when `extractMonitorHl7(event)` is non-empty:

```js
                const canReplay = source === 'yardi-hl7' && extractMonitorHl7(event);
                const actions = canReplay
                    ? `<div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button type="button" class="secondary" onclick="runMonitorReplay(${event.id}, 'dry-run')">Dry-run</button>
                        <button type="button" onclick="runMonitorReplay(${event.id}, 'inline')">Replay</button>
                       </div>`
                    : '';
```

Insert `${actions}` after the `event-meta` div in the same template string.

ALIS and `yardi-fhir` rows must not get these buttons.

- [ ] **Step 2: Verify monitor wiring**

No Jest for this file. After `npm run dev`, open `/monitor`, connect with admin BasicAuth, confirm a `yardi-hl7` row with `payload.notificationData.Message` shows Dry-run and Replay, and an ALIS row does not. Dry-run must not show the live confirm dialog; Replay must.

- [ ] **Step 3: Run regression tests**

Run:

```
npx jest --runInBand tests/integrations/yardi/yardiHl7TestMessage.test.ts tests/integrations/caspio/caspioWriteRecorder.test.ts tests/admin/yardiHl7Test.test.ts tests/http/yardiHl7Test.routes.test.ts tests/workers/processAlisEvent.test.ts tests/integrations/yardi/yardiHl7PollCapture.test.ts tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add public/webhook-monitor.html
git commit -m "$(cat <<'EOF'
feat: add HL7 dry-run and replay on the monitor

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Form-built ADT for supported triggers | 1, 4, 6 |
| Paste HL7 | 4, 6 |
| EventLog replay + extract Message / raw.message | 1, 4, 7 |
| New MSH-10 / new EventLog row | 1, 4 |
| Dry-run intercepts writes, then `ignored` / `dry_run` | 2, 4 |
| Inline calls `processAlisEventJob` | 3, 4 |
| Enqueue uses poller jobId shape; no in-request operations | 4 |
| Never ProcessACK / GetMessage | no mailbox calls in any task |
| Admin BasicAuth page + API | 5, 6 |
| Monitor Dry-run / Replay + tester link | 7 |
| Unknown facility / unsupported trigger ignore | 4 |
| Form A11 is 400 | 4, 5 |
| Worker gates reported via `skipReason` | 4 |
| FHIR overlay unchanged (no skip flag) | 4 calls existing worker |
| Jest coverage listed in spec Testing | 1, 2, 3, 4, 5 |
