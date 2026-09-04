# Yardi HL7 ADT → Caspio Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Yardi HL7 poller receives an ADT message with a known trigger, resolve the facility to a Caspio community, enqueue the event worker, and run the matching Caspio workflow.

**Architecture:** Capture still GetMessage → parse → EventLog → ProcessACK. After parse, a facility roster sets `companyKey`/`communityId`, then known triggers enqueue `process-alis-event` instead of `capture_only`. A new `yardi-hl7` orchestrator (not `handleAlisEvent`) uses `getCommunityEnrichment` for CUID and optional FHIR overlay for demographics.

**Tech Stack:** TypeScript, Jest, BullMQ, existing Caspio client / community enrichment / FHIR client

**Spec:** `docs/superpowers/specs/2026-08-20-yardi-hl7-caspio-workflows-design.md`

## Global Constraints

- Do not call `handleAlisEvent` for source `yardi-hl7`.
- Do not store CUID in poll config; resolve at event time via `getCommunityEnrichment`.
- Do not invent synthetic CUIDs (`COMM-{id}-{room}`) for these event workflows.
- Do not ProcessACK if persist or enqueue throws.
- FHIR fetch failure must not fail the event; continue HL7-only and record a warning issue (`retryable: false`).
- ALIS webhook and Yardi FHIR poll behavior stay unchanged.
- Cancel codes A11/A12/A13/A38 and unknown facilities are ignore + ProcessACK, never Caspio.
- One shared mailbox; new communities are roster rows only.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/integrations/yardi/yardiHl7PollConfig.ts` | Parse `YARDI_HL7_POLL_TARGETS`; match facility → company/community |
| `src/integrations/yardi/yardiHl7Triggers.ts` | Supported ADT codes and `lifecycleKind` map |
| `src/config/env.ts` | Add `YARDI_HL7_POLL_TARGETS` |
| `.env.example` | Document roster (no secrets) |
| `src/integrations/yardi/yardiHl7PollCapture.ts` | Resolve facility, enqueue or ignore, ProcessACK rules |
| `src/integrations/ehr/yardiHl7AdtAdapter.ts` | Put Message/RoomNumber on notificationData; FHIR overlay in `fetchResidentBundle` |
| `src/workers/processAlisEvent.ts` | Set `lifecycleKind` from trigger map for `yardi-hl7`; keep raw HL7 on the rebuilt event |
| `src/integrations/caspio/yardiHl7EventOrchestrator.ts` | CUID gate + A01/A03/A21/A22/A02/A08/A05/A60 Caspio writes |
| `src/integrations/ehr/orchestrator.ts` | `yardi-hl7` branch calling the new orchestrator |
| `src/workers/yardiHl7Poll.ts` | Warn when poll enabled and roster empty |
| Tests under `tests/integrations/yardi/`, `tests/integrations/ehr/`, `tests/integrations/caspio/` | TDD |

---

### Task 1: Facility roster config

**Files:**
- Create: `src/integrations/yardi/yardiHl7PollConfig.ts`
- Create: `tests/integrations/yardi/yardiHl7PollConfig.test.ts`
- Modify: `src/config/env.ts` (add `YARDI_HL7_POLL_TARGETS: z.string().optional()` next to `YARDI_FHIR_POLL_TARGETS`)
- Modify: `.env.example` (document the var)

**Interfaces:**
- Consumes: `env.YARDI_HL7_POLL_TARGETS`
- Produces: `YardiHl7PollTarget = { companyKey: string; communityId: number; facilityId: string }`; `parseYardiHl7PollTargets(raw: string | undefined): YardiHl7PollTarget[]`; `getConfiguredYardiHl7PollTargets(): YardiHl7PollTarget[]`; `resolveYardiHl7Facility(facilityId: string | null | undefined, targets?: YardiHl7PollTarget[]): YardiHl7PollTarget | null` (case-insensitive trim match on `facilityId`)

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/yardi/yardiHl7PollConfig.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integrations/yardi/yardiHl7PollConfig.test.ts --runInBand`

Expected: FAIL — cannot find module `yardiHl7PollConfig.js`

- [ ] **Step 3: Write minimal implementation**

Mirror `src/integrations/yardi/yardiFhirPollConfig.ts`, but the third compact field is `facilityId` not `organizationId`. JSON objects require `companyKey`, numeric `communityId`, string `facilityId`.

`resolveYardiHl7Facility` trims and uppercases both sides before compare. Empty facility → `null`.

Add to `EnvSchema` in `src/config/env.ts`:

```ts
YARDI_HL7_POLL_TARGETS: z.string().optional(),
```

Append to `.env.example`:

```env
# companyKey:caspioCommunityId:yardiFacilityId (MSH.4), comma-separated or JSON array
YARDI_HL7_POLL_TARGETS=
```

`getConfiguredYardiHl7PollTargets` returns `parseYardiHl7PollTargets(env.YARDI_HL7_POLL_TARGETS)`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/yardi/yardiHl7PollConfig.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7PollConfig.ts tests/integrations/yardi/yardiHl7PollConfig.test.ts src/config/env.ts .env.example
git commit -m "feat(yardi-hl7): parse facility roster for Caspio community mapping"
```

---

### Task 2: Trigger map helpers

**Files:**
- Create: `src/integrations/yardi/yardiHl7Triggers.ts`
- Create: `tests/integrations/yardi/yardiHl7Triggers.test.ts`
- Modify: `src/integrations/ehr/yardiHl7AdtAdapter.ts` — replace private `toLifecycle` with `lifecycleFromYardiHl7Trigger`

**Interfaces:**
- Consumes: `EhrLifecycleKind` from `src/integrations/ehr/types.ts`
- Produces: `SUPPORTED_YARDI_HL7_TRIGGERS: ReadonlySet<string>` containing `A01 A02 A03 A05 A08 A21 A22 A60`; `normalizeYardiHl7Trigger(value: string | undefined): string`; `lifecycleFromYardiHl7Trigger(trigger: string): EhrLifecycleKind`; `lifecycleFromYardiHl7EventType(eventType: string): EhrLifecycleKind`; `isSupportedYardiHl7Trigger(trigger: string): boolean`; `isSupportedYardiHl7EventType(eventType: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/yardi/yardiHl7Triggers.test.ts`:

```ts
import {
  isSupportedYardiHl7EventType,
  isSupportedYardiHl7Trigger,
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

  it('parses eventType hl7.adt.a01', () => {
    expect(isSupportedYardiHl7EventType('hl7.adt.a01')).toBe(true);
    expect(lifecycleFromYardiHl7EventType('hl7.adt.a01')).toBe('move_in');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integrations/yardi/yardiHl7Triggers.test.ts --runInBand`

Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

`src/integrations/yardi/yardiHl7Triggers.ts`:

```ts
import type { EhrLifecycleKind } from '../ehr/types.js';

export const SUPPORTED_YARDI_HL7_TRIGGERS: ReadonlySet<string> = new Set([
  'A01',
  'A02',
  'A03',
  'A05',
  'A08',
  'A21',
  'A22',
  'A60',
]);

export function normalizeYardiHl7Trigger(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

export function isSupportedYardiHl7Trigger(trigger: string): boolean {
  return SUPPORTED_YARDI_HL7_TRIGGERS.has(normalizeYardiHl7Trigger(trigger));
}

export function triggerFromYardiHl7EventType(eventType: string): string {
  const normalized = eventType.trim().toLowerCase();
  const prefix = 'hl7.adt.';
  if (normalized.startsWith(prefix)) {
    return normalizeYardiHl7Trigger(normalized.slice(prefix.length));
  }
  return normalizeYardiHl7Trigger(eventType);
}

export function isSupportedYardiHl7EventType(eventType: string): boolean {
  return isSupportedYardiHl7Trigger(triggerFromYardiHl7EventType(eventType));
}

export function lifecycleFromYardiHl7Trigger(trigger: string): EhrLifecycleKind {
  const normalized = normalizeYardiHl7Trigger(trigger);
  if (normalized === 'A05') return 'created';
  if (normalized === 'A01') return 'move_in';
  if (normalized === 'A03') return 'move_out';
  if (normalized === 'A21') return 'leave_start';
  if (normalized === 'A22') return 'leave_end';
  if (normalized === 'A08' || normalized === 'A02' || normalized === 'A60') return 'update';
  return 'unknown';
}

export function lifecycleFromYardiHl7EventType(eventType: string): EhrLifecycleKind {
  return lifecycleFromYardiHl7Trigger(triggerFromYardiHl7EventType(eventType));
}
```

Keep `lifecycleFromYardiHl7Trigger('A05')` as `'created'` for EventLog accuracy. Caspio routing in the orchestrator uses trigger `A05` (update/insert path), not `lifecycleKind`. Test A05 as:

```ts
expect(lifecycleFromYardiHl7Trigger('A05')).toBe('created');
```

In `yardiHl7AdtAdapter.ts`, delete local `toLifecycle` and import `lifecycleFromYardiHl7Trigger`. Call it with `hl7.triggerEvent`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/yardi/yardiHl7Triggers.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7Triggers.ts tests/integrations/yardi/yardiHl7Triggers.test.ts src/integrations/ehr/yardiHl7AdtAdapter.ts
git commit -m "feat(yardi-hl7): centralize ADT trigger to lifecycle mapping"
```

---

### Task 3: Capture enqueue instead of capture_only

**Files:**
- Modify: `src/integrations/yardi/yardiHl7PollCapture.ts`
- Modify: `tests/integrations/yardi/yardiHl7PollCapture.test.ts`
- Modify: `src/workers/yardiHl7Poll.ts` — if poll enabled and roster empty, log warning `yardi_hl7_poll_enabled_without_targets`

**Interfaces:**
- Consumes: `parseInboundEvent` result; `resolveYardiHl7Facility`; `isSupportedYardiHl7EventType`; `processAlisEventQueue.add`; `markEventQueued` / `markEventIgnored`; `recordIncomingEvent`
- Produces: `drainYardiHl7Mailbox` no longer calls `markEventIgnored(..., 'capture_only')` for supported rostered events. Job `ProcessAlisEventJobData` with `notificationData.Message` (raw HL7), `TriggerEvent`, `ResidentId`, `RoomNumber`, `SendingFacility`.

Extend `DrainYardiHl7MailboxArgs` with optional:

```ts
resolveFacility?: (facilityId: string | null | undefined) => { companyKey: string; communityId: number; facilityId: string } | null;
enqueueJob?: (data: ProcessAlisEventJobData) => Promise<void>;
```

Defaults: `resolveYardiHl7Facility(id, getConfiguredYardiHl7PollTargets())` and `processAlisEventQueue.add('process-alis-event', data, { jobId: \`event-yardi-hl7-${data.eventType}-${data.eventMessageId}\`, removeOnComplete: true, removeOnFail: false })`.

- [ ] **Step 1: Update failing capture tests**

In `tests/integrations/yardi/yardiHl7PollCapture.test.ts`:

Keep existing GetMessage error tests.

Replace the `capture_only` happy-path test. Add mocks:

```ts
const markEventQueued = jest.fn();
const enqueueJob = jest.fn();
const resolveFacility = jest.fn();

jest.mock('../../../src/domains/events.js', () => ({
  recordIncomingEvent,
  markEventIgnored,
  markEventQueued,
}));
```

(`recordIncomingEvent` / `markEventIgnored` already mocked — add `markEventQueued` to that factory.)

Facility-resolved A01:

```ts
it('enqueues supported ADT for a rostered facility', async () => {
  getMessage.mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT }).mockResolvedValueOnce({ kind: 'empty' });
  recordIncomingEvent.mockResolvedValueOnce({
    eventLog: { id: 1 },
    company: { id: 9, companyKey: 'yourlife' },
    isDuplicate: false,
  });
  resolveFacility.mockReturnValue({ companyKey: 'yourlife', communityId: 113, facilityId: 'EYELIVE' });
  enqueueJob.mockResolvedValueOnce(undefined);
  markEventQueued.mockResolvedValueOnce(undefined);
  processAck.mockResolvedValueOnce(undefined);

  const summary = await drainYardiHl7Mailbox({
    client: { getMessage, processAck } as any,
    maxMessages: 50,
    resolveFacility,
    enqueueJob,
  });

  expect(summary.captured).toBe(1);
  expect(markEventIgnored).not.toHaveBeenCalled();
  expect(enqueueJob).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'yardi-hl7',
      eventType: 'hl7.adt.a01',
      companyKey: 'yourlife',
      companyId: 9,
      communityId: 113,
      eventMessageId: '10529',
      notificationData: expect.objectContaining({
        TriggerEvent: 'A01',
        ResidentId: 418612,
        SendingFacility: 'EYELIVE',
        Message: SAMPLE_ADT,
        RoomNumber: '141',
      }),
    }),
  );
  expect(markEventQueued).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'yardi-hl7', eventMessageId: '10529' }),
  );
  expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT);
});
```

Unknown facility:

```ts
it('ignores unknown facility and still ProcessACKs', async () => {
  getMessage.mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT }).mockResolvedValueOnce({ kind: 'empty' });
  recordIncomingEvent.mockResolvedValueOnce({
    eventLog: { id: 1 },
    company: { id: 9 },
    isDuplicate: false,
  });
  resolveFacility.mockReturnValue(null);
  markEventIgnored.mockResolvedValueOnce(undefined);
  processAck.mockResolvedValueOnce(undefined);

  await drainYardiHl7Mailbox({
    client: { getMessage, processAck } as any,
    maxMessages: 50,
    resolveFacility,
    enqueueJob,
  });

  expect(enqueueJob).not.toHaveBeenCalled();
  expect(markEventIgnored).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'yardi-hl7' }),
    'unknown_facility',
  );
  expect(processAck).toHaveBeenCalled();
});
```

Add SAMPLE_ADT_A11 (same as SAMPLE_ADT but `ADT^A11` / `EVN|A11`) and assert ignore reason `unsupported_trigger`, no enqueue, ProcessACK.

Duplicate test: keep ProcessACK, assert `enqueueJob` not called.

Enqueue failure test: `enqueueJob.mockRejectedValueOnce(new Error('redis down'))` — expect drain to throw and `processAck` not called.

Persist still happens **after** facility is stamped on the event (`event.companyKey`, `event.communityId`). For unknown facility, leave placeholder `yardi` / `null` as parse produced.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/yardi/yardiHl7PollCapture.test.ts --runInBand`

Expected: FAIL — still `capture_only` / `enqueueJob` not used

- [ ] **Step 3: Implement capture path**

In `drainYardiHl7Mailbox`, after `parseInboundEvent`:

1. Parse PV1-3.4 in `parseHl7Message` as `pv1Facility`. Put `Pv1Facility` on `notificationData`. Capture `facilityId` is `SendingFacility` if non-empty, else `Pv1Facility`.

   Extend `parseHl7Message` / notificationData in the adapter (this task) with `Pv1Facility` from PV1-3.4 (`parseComponent(parseField(pv1, 3), 3)`). Capture uses `SendingFacility || Pv1Facility`.

2. `target = args.resolveFacility?.(facilityId) ?? resolveYardiHl7Facility(facilityId)`.
3. If `target`: `event.companyKey = target.companyKey`; `event.communityId = target.communityId`.
4. Ensure `event.notificationData.Message` is the raw HL7 string and `RoomNumber` is the parsed room.
5. `recordIncomingEvent(event)`.
6. Duplicate → ProcessACK, continue.
7. If !target → `markEventIgnored(..., 'unknown_facility')`, ProcessACK, `captured += 1` still counts for monitor (or keep a separate ignored count — existing `captured` is fine).
8. Else if !`isSupportedYardiHl7EventType(event.eventType)` → ignore `unsupported_trigger`, ProcessACK.
9. Else build `ProcessAlisEventJobData` and `await enqueueJob(job)` then `markEventQueued`.
10. ProcessACK last. Wrap persist+enqueue in try; on throw, do not ACK.

Keep summary `captured` as the count of new EventLog rows (enqueued or ignored). Do not change the summary type.

In `registerYardiHl7PollSchedule` after password check: if `getConfiguredYardiHl7PollTargets().length === 0`, `logger.warn('yardi_hl7_poll_enabled_without_targets')`. Still register the schedule (messages will all be `unknown_facility`).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/yardi/yardiHl7PollCapture.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/workers/yardiHl7Poll.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7PollCapture.ts tests/integrations/yardi/yardiHl7PollCapture.test.ts src/integrations/ehr/yardiHl7AdtAdapter.ts src/workers/yardiHl7Poll.ts
git commit -m "feat(yardi-hl7): enqueue rostered ADT events instead of capture_only"
```

---

### Task 4: Adapter FHIR overlay and HL7 message on worker payload

**Files:**
- Modify: `src/integrations/ehr/yardiHl7AdtAdapter.ts`
- Modify: `tests/integrations/ehr/yardiHl7AdtAdapter.test.ts`

**Interfaces:**
- Consumes: `getConfiguredYardiFhirPollTargets()`; `YardiFhirClient.fetchPatientBundle(patientId)`; `mapYardiFhirBundleToDemographics(bundle, hl7Overrides)`
- Produces: `fetchResidentBundle` reads HL7 from `event.notificationData.Message` or `(event.raw as { message?: string }).message`. FHIR overlay fills insurance/contacts/diagnoses/address; HL7 wins for room, resident id, names if present, event timestamp. On FHIR error, HL7-only bundle plus `vendorPayload.fhirOverlayError: string`.

- [ ] **Step 1: Write failing tests**

Add to `yardiHl7AdtAdapter.test.ts`:

```ts
it('builds resident bundle from notificationData.Message when raw is missing', async () => {
  const adapter = new YardiHl7AdtAdapter();
  const event = adapter.parseInboundEvent(SAMPLE_YARDI_RAW);
  const workerEvent = {
    ...event,
    raw: {},
    notificationData: { ...event.notificationData, Message: SAMPLE_YARDI_RAW },
  };
  const bundle = await adapter.fetchResidentBundle({
    companyId: 10,
    companyKey: 'yourlife',
    event: workerEvent,
    residentId: 418612,
  });
  expect(bundle.demographics.roomNumber).toBe('141');
  expect(bundle.demographics.firstName).toBe('Denise');
});
```

Mock FHIR client + poll targets in a nested describe:

```ts
const fetchPatientBundle = jest.fn();
jest.mock('../../../src/integrations/yardi/yardiFhirClient.js', () => ({
  YardiFhirClient: {
    createConfigured: () => ({ fetchPatientBundle }),
    assertConfigured: jest.fn(),
  },
}));
jest.mock('../../../src/integrations/yardi/yardiFhirPollConfig.js', () => ({
  getConfiguredYardiFhirPollTargets: () => [
    { companyKey: 'yourlife', communityId: 113, organizationId: 'org-1' },
  ],
}));
```

Jest hoisting: put mocks at top of file **or** use `jest.doMock` inside a dedicated test file `tests/integrations/ehr/yardiHl7AdtAdapter.fhir.test.ts` so the existing adapter tests stay unmocked.

Create `tests/integrations/ehr/yardiHl7AdtAdapter.fhir.test.ts` with the mocks at top. Test: matching company+community fetches FHIR and `vendorPayload` includes `fhirBundle`; FHIR throw still returns HL7 demographics and `vendorPayload.fhirOverlayError`. Test: company/community not in FHIR targets → `fetchPatientBundle` not called.

Use a FHIR bundle stub with patient name `FhirFirst` and coverage; expect overlay names from FHIR **unless** HL7 names are present — spec says HL7 wins for workflow fields including identity. Keep HL7 name/DOB/room; copy insurance from FHIR into `vendorPayload.fhirBundle` for the orchestrator to map. Demographics overlay: start from HL7 `fetchResidentBundle` result, then if FHIR succeeds call `mapYardiFhirBundleToDemographics(fhir, { ...hl7Demographics, externalResidentId: hl7 id, roomNumber: hl7 room, bed: hl7 bed, room: hl7 room, updatedAtUtc: event.eventMessageDate })` so classification/onPrem from FHIR can fill gaps.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.fhir.test.ts --runInBand`

Expected: FAIL — worker-style event missing raw.message currently yields empty demographics; FHIR file missing overlay

- [ ] **Step 3: Implement**

Helper `getHl7Message(event)`:

```ts
function getHl7Message(event: CanonicalInboundEvent): string {
  const fromNotification = event.notificationData?.Message;
  if (typeof fromNotification === 'string' && fromNotification.startsWith('MSH|')) {
    return fromNotification;
  }
  const raw = event.raw as { message?: string } | undefined;
  if (typeof raw?.message === 'string') return raw.message;
  return '';
}
```

Use it in `fetchResidentBundle`.

After HL7 demographics, if `event.communityId != null`, find FHIR target by `companyKey` + `communityId`. If found, try `YardiFhirClient.createConfigured().fetchPatientBundle(String(args.residentId))`. On success, set `vendorPayload: { hl7, parsed, fhirBundle }`. On failure, log + `vendorPayload: { hl7, parsed, fhirOverlayError: message }`. Do not throw.

Also put `Message` and `RoomNumber` on `notificationData` in `parseInboundEvent` (raw path) so capture job payload is complete.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.fhir.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/ehr/yardiHl7AdtAdapter.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.fhir.test.ts
git commit -m "feat(yardi-hl7): overlay FHIR demographics on HL7 resident bundles"
```

---

### Task 5: Worker rebuilds yardi-hl7 lifecycle and raw HL7

**Files:**
- Modify: `src/workers/processAlisEvent.ts`
- Modify: `tests/workers/processAlisEvent.test.ts`

**Interfaces:**
- Consumes: `lifecycleFromYardiHl7EventType`; job `notificationData.Message`
- Produces: rebuilt `CanonicalInboundEvent` for `source === 'yardi-hl7'` has `lifecycleKind` from the trigger map and `raw: { message: notificationData.Message, ...notificationData }`

- [ ] **Step 1: Write failing test**

In `processAlisEvent.test.ts`, after existing tests, add a job with `source: 'yardi-hl7'`, `eventType: 'hl7.adt.a01'`, `notificationData: { Message: 'MSH|...', ResidentId: 418612 }`. Mock `fetchResidentBundleMock` to return a bundle whose `event` you inspect via `handleEhrEventMock`.

Assert `handleEhrEventMock` received `event.lifecycleKind === 'move_in'` and `event.raw` contains `message`.

You will need `resolveResidentIdMock` to return `418612` and `requiresResidentFetchMock` true, and `upsertResidentMock` resolved.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/workers/processAlisEvent.test.ts --runInBand`

Expected: FAIL — lifecycleKind is `unknown`

- [ ] **Step 3: Implement**

Where `canonicalEvent` is built in `processJob`:

```ts
const rawMessage =
  source === 'yardi-hl7' && typeof notificationData?.Message === 'string'
    ? notificationData.Message
    : undefined;
const canonicalEvent: CanonicalInboundEvent = {
  source,
  companyKey,
  communityId: communityId ?? null,
  eventType,
  eventMessageId,
  eventMessageDate,
  lifecycleKind:
    source === 'yardi-hl7' ? lifecycleFromYardiHl7EventType(eventType) : 'unknown',
  notificationData: notificationData ?? {},
  raw: rawMessage ? { message: rawMessage, ...(notificationData ?? {}) } : notificationData ?? {},
};
```

Import `lifecycleFromYardiHl7EventType` from `../integrations/yardi/yardiHl7Triggers.js`.

After `fetchResidentBundle`, if `vendorPayload` has `fhirOverlayError` (string), `recordEventIssue` with severity `warning`, `retryable: false`, stage `fhir_overlay`, then continue.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/workers/processAlisEvent.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workers/processAlisEvent.ts tests/workers/processAlisEvent.test.ts
git commit -m "fix(yardi-hl7): preserve HL7 payload and lifecycle on worker rebuild"
```

---

### Task 6: Orchestrator CUID gate and A01 move-in

**Files:**
- Create: `src/integrations/caspio/yardiHl7EventOrchestrator.ts`
- Create: `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts`
- Modify: `src/integrations/ehr/orchestrator.ts` — add `yardi-hl7` branch

**Interfaces:**
- Consumes: `CanonicalEventOrchestrationInput` (`event`, `residentBundle`, `companyId`, `companyKey`); `getCommunityEnrichment`; `upsertByFields`; `mapServiceRecord`; `buildYardiFhirCaspioRecords` when `vendorPayload.fhirBundle` exists
- Produces: `handleYardiHl7Event(input: CanonicalEventOrchestrationInput): Promise<void>`

- [ ] **Step 1: Write failing tests**

Create `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts` with mocks for:

- `getCommunityEnrichment`
- `upsertByFields`
- `updateRecordById`
- `findRecordByFields` / `findByPatientNumber`
- `findActiveOrLatestServiceRow`
- `recordEventIssue`
- `env` table names (`CASPIO_TABLE_NAME`, `CASPIO_SERVICE_TABLE_NAME`, `CASPIO_OFF_PREM_HISTORY_TABLE_NAME`)

Helper `baseInput(eventType, extras)` builds `CanonicalEventOrchestrationInput` with source `yardi-hl7`, communityId `113`, resident `418612`, room `141`, demographics from HL7.

Tests this task:

1. Missing communityId → `recordEventIssue` (warning, not retryable), no `upsertByFields`.
2. Enrichment without CUID when room present → issue `missing_cuid`, no patient upsert.
3. A01 with CUID `room-cuid` → `upsertByFields` patient with `PatientNumber: '418612'`, `CUID: 'room-cuid'`, `RoomNumber: '141'`, `FirstName`/`LastName` from demographics; service upsert via `upsertByFields` on service table with that CUID. `Move_in_Date` formatted from `eventMessageDate`.
4. A01 does not call a mocked `handleAlisEvent` (do not import ALIS orchestrator in this module).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts --runInBand`

Expected: FAIL — module missing

- [ ] **Step 3: Implement A01 + dispatch skeleton**

`handleYardiHl7Event`:

```ts
export async function handleYardiHl7Event(
  input: CanonicalEventOrchestrationInput,
): Promise<void> {
  const bundle = input.residentBundle;
  if (!bundle) throw new Error('Yardi HL7 event orchestration requires residentBundle');
  const communityId = bundle.communityId ?? input.event.communityId;
  if (communityId === null || communityId === undefined) {
    await recordEventIssue({ ... skip community ... });
    return;
  }
  const trigger = normalizeYardiHl7Trigger(
    String(input.event.notificationData.TriggerEvent ?? triggerFromYardiHl7EventType(input.event.eventType)),
  );
  switch (trigger) {
    case 'A01':
      await handleYardiMoveIn(input, communityId);
      return;
    default:
      throw new Error(`Unsupported Yardi HL7 trigger '${trigger}'`);
  }
}
```

`default` records issue `unsupported_trigger` and returns (should not happen for enqueued jobs). Later tasks add A03/A21/A22/A02/A08/A05/A60 cases before default.

`handleYardiMoveIn`:

- `roomNumber` from demographics or `notificationData.RoomNumber`
- `enrichment = await getCommunityEnrichment(communityId, roomNumber, fhir/community name)`
- If !enrichment.CUID → issue, return
- Build patient record: if `vendorPayload.fhirBundle`, call `buildYardiFhirCaspioRecords` then **overwrite** `CUID` with enrichment.CUID (never synthetic). Else HL7-only fields: PatientNumber, FirstName, LastName, PatientDOB (`MM/dd/yyyy` from demographics.dateOfBirth), RoomNumber, CUID, CommunityName, PatientCommunity, Move_in_Date, Service_Start_Date, On_Prem true
- `upsertByFields(CASPIO_TABLE_NAME, [{PatientNumber},{CUID}], patientRecord)`
- `mapServiceRecord` + `upsertByFields` service table with CUID, PatientNumber, StartDate, ServiceType = demographics.classification || `SERVICE_LINE_UNASSIGNED_CLASSIFICATION`

Date helper (local):

```ts
function formatCaspioDateTime(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}
```

Wire `handleEhrEvent`:

```ts
if (input.source === 'yardi-hl7') {
  await handleYardiHl7Event(input);
  return;
}
```

Add test `tests/integrations/ehr/orchestrator.yardiHl7.test.ts` (or extend an existing orchestrator test if present): mock `handleYardiHl7Event`, call `handleEhrEvent({ source: 'yardi-hl7', ...})`, assert it was called and `handleAlisEvent` was not (mock `../caspio/eventOrchestrator.js`).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts tests/http/webhook.test.ts --runInBand`

Also run: `npx jest tests/integrations/caspio/eventOrchestrator.service.test.ts --runInBand`

Expected: PASS (ALIS tests unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/caspio/yardiHl7EventOrchestrator.ts tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts src/integrations/ehr/orchestrator.ts tests/integrations/ehr/orchestrator.yardiHl7.test.ts
git commit -m "feat(yardi-hl7): run Caspio move-in workflow for A01"
```

---

### Task 7: A03 move-out and A21/A22 leave

**Files:**
- Modify: `src/integrations/caspio/yardiHl7EventOrchestrator.ts`
- Modify: `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts`

**Interfaces:**
- Consumes: `findRecordByFields` / `findByPatientNumber` (patient lookup by PatientNumber+CUID then PatientNumber); `updateRecordById`; `findActiveOrLatestServiceRow`; `mapOffPremStartEpisode`; `mapOffPremEndPatch`; `upsertOffPremEpisodeByEpisodeId`; `findOpenOffPremEpisode`
- Produces: A03/A21/A22 branches in `handleYardiHl7Event`

- [ ] **Step 1: Write failing tests**

A03: existing patient found → `updateRecordById` sets `Move_Out_Date`, `Service_End_Date`, `On_Prem: false`; `findActiveOrLatestServiceRow` found → `updateRecordById` on service with `EndDate`. Patient not found → issue, no update.

A21: existing patient → patient patch `Off_Prem: true`, `On_Prem: false`, `Off_Prem_Date` from eventMessageDate; `upsertOffPremEpisodeByEpisodeId` called. Missing patient → issue skip.

A22: `findOpenOffPremEpisode` found → `updateRecordById` episode with end patch; patient `Off_Prem: false`, `On_Prem: true`. Missing patient → skip with issue.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts --runInBand`

Expected: FAIL — A03/A21/A22 hit default/unsupported

- [ ] **Step 3: Implement**

Shared `findExistingPatient(patientNumber, cuid)` same pattern as ALIS (try PatientNumber+CUID, then PatientNumber).

A03: if !existing, issue `Move-out event skipped because resident was not found in Caspio`, return. Else patch patient dates from `event.eventMessageDate` via `formatCaspioDateTime`. Close latest service row if found (else issue warning, still succeed patient patch).

A21: `mapOffPremStartEpisode({ patientNumber, cuid: enrichment.CUID, communityName: enrichment.CommunityName, offPremStart: formatCaspioDateTime(event.eventMessageDate) })`. No LeaveId from HL7 is fine.

A22: `findOpenOffPremEpisode({ patientNumber, cuid })`. If found, `mapOffPremEndPatch({ offPremStart: record.OffPremStart, offPremEnd: formatCaspioDateTime(event.eventMessageDate) })`. If no open episode, warning issue and still flip On_Prem on patient if patient exists.

Still require CUID from enrichment for these writes; if missing CUID, skip like A01.

Add switch cases `A03`, `A21`, `A22`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/caspio/yardiHl7EventOrchestrator.ts tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts
git commit -m "feat(yardi-hl7): Caspio move-out and leave workflows for A03/A21/A22"
```

---

### Task 8: A02 transfer and A08/A05/A60 updates

**Files:**
- Modify: `src/integrations/caspio/yardiHl7EventOrchestrator.ts`
- Modify: `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts`

**Interfaces:**
- Consumes: same Caspio client helpers as Task 7
- Produces: A02 closes service on previous CUID (from existing patient row) and opens service on new room CUID; A05 upserts even if missing; A08/A60 skip if missing

- [ ] **Step 1: Write failing tests**

A02: existing patient `CUID: 'old-cuid'`, `RoomNumber: '100'`; enrichment for new room `141` returns `new-cuid`; assert close on old service (`findActiveOrLatestServiceRow` with `old-cuid`) and create service with `new-cuid`; patient upserted with new room/CUID.

A05: patient not found → `upsertByFields` insert (move-in-like without requiring prior row).

A08: patient not found → issue, no upsert.

A60: same as A08.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts --runInBand`

Expected: FAIL

- [ ] **Step 3: Implement**

`handleYardiUpdate(input, communityId, { insertIfMissing: boolean, isTransfer: boolean })`.

Build patient patch from HL7 (+ FHIR records if present). Look up existing with current enrichment CUID, then by PatientNumber.

- A08/A60: `insertIfMissing false` → skip with issue if not found; else `updateRecordById`.
- A05: if not found, `upsertByFields` like A01 (including service row if CUID present).
- A02: `isTransfer true`. `previousCuid = existing.record?.CUID`. `nextCuid = enrichment.CUID`. If both present and different, close service on previousCuid, open on nextCuid with event datetime. Always patch patient room + CUID to next.

Missing CUID still skips.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/integrations/yardi/yardiHl7PollCapture.test.ts tests/http/webhook.test.ts tests/workers/processAlisEvent.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/caspio/yardiHl7EventOrchestrator.ts tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts
git commit -m "feat(yardi-hl7): Caspio transfer and update workflows for A02/A05/A08/A60"
```

---

### Task 9: Regression sweep

**Files:**
- No new production files unless a test revealed a gap
- Test: run the suites listed below

**Interfaces:**
- Consumes: all prior tasks
- Produces: confirmation ALIS and FHIR poll tests still pass; `handleAlisEvent` unused for yardi-hl7

- [ ] **Step 1: Run ALIS and FHIR regression**

Run:

```
npx jest tests/http/webhook.test.ts tests/integrations/caspio/eventOrchestrator.service.test.ts tests/integrations/caspio/eventOrchestrator.leave.test.ts tests/integrations/yardi/yardiFhirSync.test.ts tests/workers/yardiHl7Poll.test.ts --runInBand
```

Expected: PASS

- [ ] **Step 2: Run full unit suite if Step 1 passed**

Run: `npx jest --runInBand`

Expected: PASS

- [ ] **Step 3: Commit only if Step 2 required test or doc fixes**

If no file changes, skip commit.

If you added a note to `.env.example` or a monitor comment, commit:

```bash
git add -u
git commit -m "test(yardi-hl7): confirm ALIS and FHIR poll paths stay unchanged"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|------------------|------|
| Trigger map A01/A03/A21/A22/A02/A08/A05/A60 | 2, 6–8 |
| Cancel A11–A13/A38 ignore | 2, 3 |
| Roster `YARDI_HL7_POLL_TARGETS` | 1, 3 |
| CUID via `getCommunityEnrichment`, no synthetic | 6 |
| HL7 + optional FHIR overlay | 4, 5 |
| Enqueue `process-alis-event`, not `handleAlisEvent` | 3, 6 |
| Facility before `recordIncomingEvent` | 3 |
| Unknown facility / unsupported trigger ignore + ACK | 3 |
| Persist/enqueue fail → no ACK | 3 |
| FHIR fail → warning, HL7-only | 4, 5 |
| Empty roster warning | 3 |
| `EHR_ENABLED_COMMUNITY_IDS` unchanged worker gate | 5 (existing code; no change unless tests fail) |
| ALIS / FHIR poll unchanged | 9 |
