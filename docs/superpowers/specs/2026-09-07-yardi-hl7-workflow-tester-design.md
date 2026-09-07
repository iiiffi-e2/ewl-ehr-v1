# Yardi HL7 Workflow Tester — Design

**Date:** 2026-09-07  
**Status:** Approved  
**Scope:** Admin page + API to inject or replay a Yardi HL7 ADT through the existing Caspio workflows without changing data in Yardi. Optional Dry-run / Replay controls on `/monitor`.

**Extends:** `2026-08-20-yardi-hl7-caspio-workflows-design.md`. Transport (GetMessage / ProcessACK) is unchanged. This path never talks to the Yardi mailbox.

## Goal

Replace the manual loop (edit a resident in Yardi → wait for the poller → hope Caspio wrote) with a tool that fires a specific ADT (form-built, pasted, or replayed) through the same parse → EventLog → orchestrator → Caspio path, and returns the write result immediately.

## Decisions

| Topic | Choice |
|-------|--------|
| Live vs preview | Live Caspio write is the default. Optional dry-run shows planned writes and never upserts. |
| Event source | Form-built ADT, pasted raw HL7, or replay of an existing `yardi-hl7` EventLog row. |
| Surface | Admin page at `/admin/yardi-hl7-test` plus the same API for curl/scripts. Monitor adds Dry-run / Replay on eligible rows. |
| Execution | Inline by default (same function the `process-alis-event` worker runs). Optional enqueue uses that queue. |
| Identity | Always persist a **new** EventLog row. Mint a new MSH-10 so replay is never a duplicate. The original row is not mutated. |
| Mailbox | Never call GetMessage or ProcessACK. |
| Auth | Existing admin BasicAuth. |
| FHIR overlay | Same as production: fetch when `companyKey` + `communityId` is in `YARDI_FHIR_POLL_TARGETS`. No extra skip flag. |
| Worker gates | Honor `EHR_ADAPTER_ENABLED`, `EHR_ENABLED_COMMUNITY_IDS`, and `EHR_SHADOW_MODE`. If a live run skips Caspio because of a gate, the response must say so (`caspio.wrote: false` + `skipReason`). |

## Trigger map

Same as the 2026-08-20 workflow spec. The form offers only supported codes:

| HL7 code | `eventType` | Caspio workflow |
|----------|-------------|-----------------|
| A01 | `hl7.adt.a01` | Move-in: upsert patient + open service |
| A02 | `hl7.adt.a02` | Room transfer / update |
| A03 | `hl7.adt.a03` | Move-out: close service |
| A05 | `hl7.adt.a05` | Pre-admit / new resident update |
| A08 | `hl7.adt.a08` | Patient update |
| A21 | `hl7.adt.a21` | Leave start |
| A22 | `hl7.adt.a22` | Leave end |
| A60 | `hl7.adt.a60` | Patient update |

Pasted or replayed cancel codes (A11 / A12 / A13 / A38) and any other trigger persist EventLog, mark ignored (`unsupported_trigger`), and return that reason. No Caspio.

## Architecture

```
Admin page / Monitor / curl
        ↓
POST /admin/yardi-hl7-test/run
        ↓
runYardiHl7Test
  1. Resolve HL7 (build | paste | EventLog Message)
  2. Remint MSH-10 (new message-control id)
  3. Parse with YardiHl7AdtAdapter
  4. Resolve facility via YARDI_HL7_POLL_TARGETS
  5. recordIncomingEvent (new row)
  6. mode:
       dry-run  → processAlisEventJob with write interception, then mark ignored `dry_run`
       inline   → processAlisEventJob(data); processed or failed
       enqueue  → process-alis-event job + markEventQueued
```

`processAlisEventJob` is the extracted body of the current `process-alis-event` worker handler. The BullMQ worker calls it. Inline mode calls it with the same `ProcessAlisEventJobData` shape the poller already enqueues (`source`, `eventMessageId`, `eventType`, `companyKey`, `companyId`, `communityId`, `notificationData` including `Message`, `eventMessageDate`).

## Components

### 1. HL7 builder and remint — `src/integrations/yardi/yardiHl7TestMessage.ts`

`buildYardiHl7Adt(input)` emits a parseable ADT:

```
MSH|^~\&|Yardi|{facilityId}|EyeWatchLive|EyeWatchLive|{hl7DateTime}||ADT^{trigger}|{messageControlId}|P|2.5
EVN|{trigger}|{hl7DateTime}
PID|1||{residentId}||{lastName}^{firstName}^||{dateOfBirth}|{gender}
PV1|1|I^Current|AZone1^{roomNumber}^Single^{facilityId}
```

- `hl7DateTime` is now, `YYYYMMDDHHMMSS`.
- `messageControlId` is at most 20 characters: `T` + unix milliseconds (13 digits) + 4 hex chars (example `T1788800000123ab`, 18 characters).
- Optional name defaults to `Resident^Test` when omitted.
- Optional DOB / gender are left empty when omitted.
- Segments are joined with `\r`.

`remintYardiHl7MessageControlId(hl7)` replaces MSH-10 (pipe field index 9) with a newly minted id and returns `{ hl7, messageControlId }`. Used for paste and EventLog replay.

### 2. Test runner — `src/admin/yardiHl7Test.ts`

`getYardiHl7TestConfig()` returns poll enablement, roster targets, supported triggers, Caspio table names, `EHR_ADAPTER_ENABLED`, `EHR_SHADOW_MODE`, and `ehrEnabledCommunityIds`.

`runYardiHl7Test(input)` accepts exactly one source:

| `source` | Required fields |
|----------|-----------------|
| `form` | `trigger` (must be a supported code; `A11` and other unsupported codes are `400` here — they are only valid on paste/replay), `residentId`, `roomNumber`. `facilityId` required when the roster has more than one row; when the roster has exactly one row it may be omitted and that row is used. Optional: `firstName`, `lastName`, `dateOfBirth`, `gender`. |
| `hl7` | `hl7` (must start with `MSH\|`) |
| `eventLog` | `eventLogId` **or** `eventMessageId` |

`mode` is `inline` (default), `dry-run`, or `enqueue`. `dry-run` + `enqueue` is rejected before persist (`400`). The page will not POST that combination.

EventLog replay rules:

- Row `source` must be `yardi-hl7`.
- Raw HL7 is `payload.notificationData.Message` if it starts with `MSH|`, else `payload.raw.message`.
- Any other source, or a row with no extractable HL7, is a `400` and nothing is persisted.

Facility resolution uses `resolveYardiHl7Facility` against `getConfiguredYardiHl7PollTargets()`, same as the poller (MSH.4, then PV1 facility). Unknown facility: persist, `markEventIgnored(..., 'unknown_facility')`, return `success: false` with that reason. No Caspio.

### 3. Caspio write recorder

A request-scoped recorder wraps the three Caspio write functions (`upsertByFields`, `updateRecordById`, `upsertOffPremEpisodeByEpisodeId`). `handleYardiHl7Event` is not forked.

- **inline / enqueue:** recorder logs each call, then calls through.
- **dry-run:** recorder logs each call and does **not** call through.

Reads stay live: `getCommunityEnrichment`, `findByPatientNumber`, `findRecordByFields`, `findActiveOrLatestServiceRow`, `findOpenOffPremEpisode`, plus FHIR overlay when configured.

Recorded calls become `caspio.operations` (`table`, `action`, `fields` / `record`).

Dry-run still invokes `processAlisEventJob` so routing and lookups match production. After that function returns, the runner calls `markEventIgnored(..., 'dry_run')`, which is the terminal EventLog status (it overwrites `processed` from the worker). If `processAlisEventJob` throws, the event stays `failed` and is not rewritten to `dry_run`.

### 4. Admin HTTP

| Method | Path | Role |
|--------|------|------|
| GET | `/admin/yardi-hl7-test` | Redirect to `/public/yardi-hl7-test.html` |
| GET | `/admin/yardi-hl7-test/config` | `getYardiHl7TestConfig()` |
| POST | `/admin/yardi-hl7-test/run` | `runYardiHl7Test(req.body)` |

All three use `authAdmin`.

`POST` body:

```json
{
  "mode": "inline",
  "source": "form",
  "trigger": "A01",
  "residentId": "418612",
  "roomNumber": "141",
  "facilityId": "EYELIVE"
}
```

`source: "hl7"` uses `hl7`. `source: "eventLog"` uses `eventLogId` or `eventMessageId`.

`POST` response (200 when the runner finished, including workflow skips/failures):

```json
{
  "success": true,
  "mode": "inline",
  "event": {
    "id": 123,
    "eventMessageId": "T1757262000a1b2",
    "eventType": "hl7.adt.a01",
    "status": "processed",
    "companyKey": "yourlife",
    "communityId": 113
  },
  "parsed": {
    "trigger": "A01",
    "residentId": "418612",
    "roomNumber": "141",
    "facilityId": "EYELIVE"
  },
  "enrichment": { "CUID": "...", "communityName": "..." },
  "caspio": {
    "wrote": true,
    "skipReason": null,
    "operations": [{ "table": "CarePatientTable_API", "action": "upsert", "fields": {} }]
  },
  "issues": [],
  "hl7": "MSH|...",
  "jobId": null
}
```

`jobId` is set only for `enqueue`. Enqueue returns immediately after queue add: `caspio.wrote` is false, `caspio.operations` is `[]`, `skipReason` is null, and EventLog is `queued`. The worker writes Caspio later without the request-scoped recorder.

`caspio.wrote` is true only when a mutating Caspio call succeeded in-request (inline only; never true for dry-run or enqueue). `skipReason` is exactly one of: `null`, `dry_run`, `unknown_facility`, `unsupported_trigger`, `ehr_adapter_disabled`, `ehr_community_not_enabled`, `ehr_shadow_mode`, `missing_cuid`.

HTTP status:

| Condition | Status | Persist? |
|-----------|--------|----------|
| Missing/invalid `source`, missing fields for that source, form trigger not supported, dry-run+enqueue, replay wrong source / no HL7 | 400 | No |
| Admin auth failed | 401 | No |
| Runner completed (including ignored / failed EventLog) | 200 | Yes (except 400 cases) |
| Unexpected throw (Redis down on enqueue, unhandled) | 500 | Event may exist as `received` or `failed` |

### 5. Admin page — `public/yardi-hl7-test.html`

Same visual language as `public/yardi-fhir-test.html`. Three source modes: **Build ADT**, **Paste HL7**, **Replay EventLog**.

Checkboxes:

- **Dry-run** — off by default
- **Enqueue like the poller** — off by default

Neither checked = inline live write.

Live Run (dry-run unchecked) shows a confirm dialog with trigger, resident id, room, facility, company, and community before `POST`. The result pane shows parsed fields, CUID, EventLog id/status, Caspio operations (written or planned), issues, and the HL7 that ran.

`GET /admin/yardi-hl7-test/config` fills the facility dropdown and shows poll / Caspio / gate config.

### 6. Monitor replay — `public/webhook-monitor.html`

Each listed event with `source === 'yardi-hl7'` and an extractable `MSH|` message gets **Dry-run** and **Replay**.

- Dry-run posts `{ source: "eventLog", eventLogId, mode: "dry-run" }`.
- Replay posts `{ source: "eventLog", eventLogId, mode: "inline" }` after the same confirm dialog as the tester page (trigger, resident, room, community).

ALIS and `yardi-fhir` rows have no these buttons. A short link to `/admin/yardi-hl7-test` sits in the monitor header.

## Data flow

1. Resolve HL7 string from form, paste, or EventLog.
2. Remint MSH-10.
3. `YardiHl7AdtAdapter.parseInboundEvent(hl7)`.
4. Set `notificationData.Message` to the reminted HL7.
5. Resolve facility → `companyKey` / `communityId`.
6. `recordIncomingEvent`.
7. If no facility or unsupported trigger: ignore and return.
8. Else run the chosen mode. Inline and dry-run both go through `processAlisEventJob` (dry-run with write interception; runner then marks ignored `dry_run`). Enqueue uses the same `processAlisEventQueue.add` options as `drainYardiHl7Mailbox` (`jobId: event-yardi-hl7-${eventType}-${eventMessageId}`).
9. Reload EventLog + issues for the new `eventMessageId` and return them with parsed fields, enrichment, operations, and HL7.

## Error handling

| Condition | Behavior |
|-----------|----------|
| Unknown facility | Persist, ignore `unknown_facility`, no Caspio, `success: false`. |
| Unsupported trigger | Persist, ignore `unsupported_trigger`, no Caspio, `success: false`. |
| Replay missing HL7 / wrong source | `400`, nothing persisted. |
| No room / no CUID from `CommunityTable_API` | Same as production: non-retryable issue, skip write, EventLog processed, `skipReason: missing_cuid`. |
| Caspio write failure | Event `failed`, issues in the response, `success: false`. |
| Enqueue but Redis is down | `500`. Event stays `received` (not queued). |
| FHIR overlay failure | Same as production: warning issue, continue HL7-only. |
| `EHR_SHADOW_MODE` or adapter/community gate | Event processed; `caspio.wrote: false` and the matching `skipReason`. |

## Testing

Jest, Caspio writes mocked. Live Caspio is not required in CI.

- Builder emits a parseable ADT for each supported trigger; adapter reads trigger, resident id, room, facility, and message-control id.
- `remintYardiHl7MessageControlId` changes MSH-10 and keeps other fields.
- Dry-run returns planned operations and never calls `upsertByFields` / `updateRecordById` / `upsertOffPremEpisodeByEpisodeId`.
- Inline mints a new message-control id, calls `processAlisEventJob`, and does not treat the run as a duplicate of the source EventLog.
- EventLog replay reads `notificationData.Message` (fallback `raw.message`) and rejects `alis` / `yardi-fhir` / missing HL7 with no persist.
- Unknown facility, cancel codes, and dry-run+enqueue behave as in Error handling.
- Enqueue mode adds `process-alis-event` with the poller jobId shape and does not call `processAlisEventJob` in-request.
- Route tests: `authAdmin` required; exactly one source required; config returns roster and triggers.
- Existing poller, capture, adapter, and `yardiHl7EventOrchestrator` tests stay green.

## Out of scope

- Calling Yardi GetMessage / ProcessACK / SendMessage
- Cancel-event workflows (A11 / A12 / A13 / A38)
- Changing poll cadence, roster parse, or FHIR poll
- ALIS `/admin/simulate-webhook` behavior
- CI jobs that write to a real Caspio account
- Restricting live writes to a hardcoded test-resident allowlist

## Success criteria

- From `/admin/yardi-hl7-test`, an A01 for a rostered facility and real room CUID creates a new EventLog row and (unless dry-run or a worker gate) upserts the patient and opens a service row in Caspio. The page shows CUID, EventLog status, and the operations.
- The same A01 with Dry-run checked shows those operations and leaves Caspio unchanged.
- `/monitor` Dry-run / Replay on a captured `yardi-hl7` A08 (or any supported code) creates a **new** EventLog row and runs that exact payload again (new MSH-10).
- A test run never ProcessACKs the Yardi mailbox.
- Unknown facility and cancel codes are ignored and explained in the API response.
- ALIS webhook and Yardi FHIR poll paths are unchanged.

## File map

| File | Responsibility |
|------|----------------|
| `src/integrations/yardi/yardiHl7TestMessage.ts` | Build canned ADT; remint MSH-10 |
| `src/admin/yardiHl7Test.ts` | Config + `runYardiHl7Test` |
| `src/workers/processAlisEvent.ts` | Export `processAlisEventJob`; worker calls it |
| `src/http/routes.ts` | Config + run + page redirect |
| `public/yardi-hl7-test.html` | Tester page |
| `public/webhook-monitor.html` | Dry-run / Replay + link to tester |
| `tests/integrations/yardi/yardiHl7TestMessage.test.ts` | Builder / remint |
| `tests/admin/yardiHl7Test.test.ts` | Runner modes and guards |
| `tests/http/yardiHl7Test.routes.test.ts` | Auth and validation for `/admin/yardi-hl7-test/*` |
