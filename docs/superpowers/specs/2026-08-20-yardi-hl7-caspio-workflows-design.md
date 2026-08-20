# Yardi HL7 ADT → Caspio Workflows — Design

**Date:** 2026-08-20  
**Status:** Approved  
**Scope:** Connect polled Yardi HL7 ADT messages to existing Caspio workflows by trigger code. Transport (GetMessage / ProcessACK) stays as in `2026-07-13-yardi-hl7-restful-broker-poller-design.md`.

**Extends:** The 2026-07-13 poller was capture-only (`markEventIgnored(..., 'capture_only')`, no Caspio). This document replaces that processing choice. Transport, mailbox identity, and ProcessACK rules for success/duplicate remain.

## Goal

When the HL7 poller picks up an ADT message with a known trigger code, resolve the Yardi facility to a Caspio community, enqueue the existing event worker, and run the matching Caspio workflow (move-in, move-out, leave, update). CUID is resolved at event time from `CommunityTable_API`, not from poll config.

## Decisions

| Topic | Choice |
|-------|--------|
| Trigger → workflow | A01 move-in; A03 move-out; A21 leave start; A22 leave end; A02/A08/A05/A60 update (A02 = room transfer) |
| Cancel codes | A11, A12, A13, A38: persist + ignore (`unsupported_trigger`); no Caspio |
| Community mapping | Env roster `YARDI_HL7_POLL_TARGETS`: `companyKey:communityId:facilityId` (JSON array also allowed) |
| CUID | Runtime via existing `getCommunityEnrichment(communityId, pv1Room, communityName)` |
| Resident data | HL7 for workflow fields (code, room, resident id, timestamp). If the same company+community exists in `YARDI_FHIR_POLL_TARGETS`, fetch FHIR for insurance/contacts/diagnoses/address. Otherwise HL7-only. |
| Wiring | Enqueue `process-alis-event`; new `yardi-hl7` branch in `handleEhrEvent`. Do not call `handleAlisEvent`. |
| Mailbox | One shared GetMessage mailbox. New communities are roster rows, not new broker URLs. |
| Company persist | Resolve facility **before** `recordIncomingEvent` so EventLog uses the real `companyKey` / `communityId` |

## Trigger map

| HL7 code | `eventType` | `lifecycleKind` | Caspio workflow |
|----------|-------------|-----------------|-----------------|
| A01 | `hl7.adt.a01` | `move_in` | Upsert patient + open service row |
| A03 | `hl7.adt.a03` | `move_out` | Set move-out / service end; close active service |
| A21 | `hl7.adt.a21` | `leave_start` | Off-prem episode start |
| A22 | `hl7.adt.a22` | `leave_end` | Off-prem episode end |
| A02 | `hl7.adt.a02` | `update` | Patient update; PV1 room is the new room for CUID / service transfer |
| A08 | `hl7.adt.a08` | `update` | Patient update |
| A05 | `hl7.adt.a05` | `update` | Patient update (pre-admit / new resident) |
| A60 | `hl7.adt.a60` | `update` | Patient update |
| A11, A12, A13, A38 | `hl7.adt.a11` etc. | n/a | Ignore (`unsupported_trigger`) |

Any other trigger is ignored the same way as cancel codes.

## Architecture

```
GetMessage
  → parse ADT (trigger, PID resident id, PV1 room, MSH.4 facility)
  → match facility to YARDI_HL7_POLL_TARGETS → companyKey + Caspio CommunityID
  → persist EventLog with those values
  → known code? enqueue process-alis-event + markEventQueued
     unknown code / unknown facility? markEventIgnored
  → ProcessACK (success and duplicate always ACK; persist/enqueue failure does not ACK)
        │
        ▼
process-alis-event worker
  → rebuild canonical event from job payload (includes raw HL7)
  → optional FHIR fetch if companyKey+communityId is in YARDI_FHIR_POLL_TARGETS
  → upsert local Resident
  → handleEhrEvent(source = yardi-hl7)
        CUID = getCommunityEnrichment(CommunityID, PV1 room)
        dispatch by trigger / eventType as in the table above
```

ALIS webhook processing and Yardi FHIR poll stay unchanged. `handleAlisEvent` is not used for `yardi-hl7`.

## Components

### 1. Facility roster — env `YARDI_HL7_POLL_TARGETS`

Same parse style as `YARDI_FHIR_POLL_TARGETS`:

- Compact: `companyKey:communityId:facilityId` comma-separated
- JSON array of `{ companyKey, communityId, facilityId }`

Match on `MSH.4` (Sending Facility), falling back to `PV1-3.4` if MSH.4 is empty.

Do **not** store CUID here. `CommunityTable_API` is room-level: CUID is unique per `(CommunityID, CommunityName, RoomNumber)`.

Do **not** duplicate FHIR `organizationId` here. FHIR overlay looks up `YARDI_FHIR_POLL_TARGETS` by the same `companyKey` + `communityId`.

Onboarding a community: add a roster row (and a FHIR poll target if FHIR overlay is desired). One shared mailbox for this phase.

### 2. Capture path — `drainYardiHl7Mailbox`

After `YardiHl7AdtAdapter.parseInboundEvent`:

1. Resolve facility → set `event.companyKey` and `event.communityId`.
2. `recordIncomingEvent` (company upsert uses the resolved key, not placeholder `yardi`).
3. Duplicate → ProcessACK, no enqueue.
4. Unknown facility → `markEventIgnored(..., 'unknown_facility')`, ProcessACK.
5. Unsupported trigger → `markEventIgnored(..., 'unsupported_trigger')`, ProcessACK.
6. Known trigger → enqueue `process-alis-event` with job data that includes:
   - existing fields: `source`, `eventMessageId`, `eventType`, `companyKey`, `companyId`, `communityId`, `eventMessageDate`
   - `notificationData` containing at least: `TriggerEvent`, `ResidentId`, `RoomNumber`, `SendingFacility`, `Message` (raw HL7 string)
7. `markEventQueued`
8. ProcessACK

If persist or enqueue throws, do not ProcessACK so Yardi can redeliver.

### 3. Adapter — `YardiHl7AdtAdapter`

`fetchResidentBundle` reads the HL7 from `notificationData.Message` or `event.raw.message` (both must work).

HL7 supplies: resident id (PID-3), name (PID-5), DOB (PID-7), room/bed (PV1-3), event timestamp.

If a FHIR poll target exists for this company+community:

- Fetch FHIR patient bundle by resident/patient id.
- Overlay insurance, contacts, diagnoses, address onto demographics.
- HL7 wins for workflow fields: trigger/lifecycle, room, resident id, event timestamp.

If FHIR is not configured, the bundle is HL7 demographics only.

`processAlisEvent` currently rebuilds `CanonicalInboundEvent` with `lifecycleKind: 'unknown'` and `raw: notificationData`. The Yardi orchestrator must dispatch by `eventType` (`hl7.adt.a01`, …) or `notificationData.TriggerEvent`, not the worker default lifecycle. The worker should also set `lifecycleKind` from the trigger map when rebuilding the event so downstream logs stay accurate.

### 4. Orchestrator — `handleEhrEvent` branch `yardi-hl7`

New module (for example `src/integrations/caspio/yardiHl7EventOrchestrator.ts`) called from `handleEhrEvent`. It must not call `handleAlisEvent`.

Shared primitives to reuse, not copy:

- `getCommunityEnrichment` for CUID / community name
- `caspioClient` upserts/updates (`upsertByFields`, `updateRecordById`, patient lookup)
- Service-row and off-prem helpers already used by the ALIS orchestrator (extract/export as needed rather than duplicating close/open/leave logic)
- FHIR patient field mapping from `buildYardiFhirCaspioRecords` when a FHIR bundle is present
- Thin HL7-only patient mapping (PatientNumber, name, DOB, RoomNumber, CUID, CommunityName) when FHIR is absent

Workflow behavior:

- **A01 move-in:** upsert patient by PatientNumber+CUID; open service row when CUID is resolved. Service type from FHIR classification when present, otherwise unassigned classification.
- **A03 move-out:** find existing patient; set Move_Out_Date / Service_End_Date / On_Prem false; close active service. If patient not found, record issue and skip (same as ALIS).
- **A21 leave start / A22 leave end:** off-prem episode keyed by patient + CUID; event datetime from MSH.7 / EVN when LeaveId is absent. If patient not found, record issue and skip.
- **A02 transfer:** treat PV1 room as the new room; resolve previous CUID from existing patient row and next CUID from enrichment; close old service, open new (same idea as ALIS room change).
- **A08 / A05 / A60 update:** patch existing patient; A05 may insert if no row exists (pre-admit / new). A08/A60 skip with issue if patient not found.

Missing CommunityId after roster resolution cannot happen for enqueued jobs (unknown facility is ignored at capture). If it does, skip with an issue.

## CUID resolution

```
communityId  ← roster (Caspio CommunityID)
roomNumber   ← PV1-3.2 (example AZone1^141^Single^EYELIVE → 141)
communityName ← CommunityTable_API via findCommunityById, else FHIR encounter/patient display
CUID         ← getCommunityEnrichment(communityId, roomNumber, communityName)
```

If room is present but room-level CUID is missing, record a non-retryable issue and skip the Caspio write. Do not invent a synthetic CUID for these event workflows (FHIR poll may still use `COMM-{id}-{room}` for its own sync path; event workflows must attach to a real room row).

## Error handling

| Condition | Behavior |
|-----------|----------|
| Unknown facility | Persist, ignore (`unknown_facility`), ProcessACK. Visible on `/monitor`. |
| Cancel / other unsupported trigger | Persist, ignore (`unsupported_trigger`), ProcessACK. |
| Duplicate `EventMessageId` | ProcessACK, do not enqueue again. |
| Persist or enqueue failure | Do not ProcessACK. |
| ProcessACK failure after enqueue | Log warning. Redelivery is a duplicate. |
| FHIR fetch failure | Record a warning issue (`retryable: false`); continue with HL7-only fields. Do not fail the event solely because FHIR is down. |
| No room / no CUID from `CommunityTable_API` | Non-retryable issue; skip Caspio write; mark event processed. |
| Caspio write failure | Event `failed`; worker retries as today. |
| Missing PID resident id | Event `failed` with payload issue. |

## Configuration

| Variable | Purpose |
|----------|---------|
| `YARDI_HL7_POLL_TARGETS` | Roster: `companyKey:communityId:facilityId` or JSON array. Required for Caspio enqueue. |
| Existing `YARDI_HL7_POLL_*` | Unchanged (enable, interval, URLs, mailbox password, max messages). |
| Existing `YARDI_FHIR_POLL_TARGETS` | Optional overlay: same `companyKey`+`communityId` → fetch FHIR `organizationId` / patient bundle. |
| Existing `EHR_ADAPTER_ENABLED` / `EHR_ENABLED_COMMUNITY_IDS` | Same worker gates as other non-ALIS sources. If the enabled-community list is non-empty, the roster `communityId` must be on it or the worker marks the event processed without Caspio. |

If poll is enabled and the roster is empty, log a warning. Every message then matches as unknown facility (persist, ignore, ProcessACK) and nothing is enqueued.

## Out of scope

- `SendMessage` (pharmacy → Yardi)
- Cancel-event workflows (A11/A12/A13/A38)
- Per-facility mailbox URLs or passwords
- Changing Yardi FHIR poll cadence or its own Caspio sync
- ALIS webhook behavior
- Unifying FHIR and HL7 targets into one onboarding record (can follow later)

## Testing

- Roster parse: compact and JSON forms; reject incomplete entries.
- Facility match: `EYELIVE` maps to expected company/community; unknown facility ignored, not enqueued.
- Capture enqueue: A01 queued with raw HL7 on the job; A11 ignored; duplicates ProcessACK without a second job.
- Code routing: A01/A03/A21/A22/A02/A08/A05/A60 hit the matching orchestrator path; cancel codes never call Caspio.
- CUID: room `141` + CommunityID uses `getCommunityEnrichment`; missing room/CUID records an issue and skips the write.
- FHIR overlay: matching FHIR target fetches and fills insurance/contacts; FHIR error still writes HL7-only fields.
- HL7-only fallback: no FHIR target → patient upsert from PID/PV1 only.
- Regression: ALIS webhook enqueue and Yardi FHIR poll tests stay green; `handleAlisEvent` is not called for `yardi-hl7`.

## Success criteria

- A polled A01 for a rostered facility appears on `/monitor` as queued then processed, and Caspio has a patient + open service row on the room CUID.
- A polled A03 closes that service / sets move-out on the existing patient.
- Unknown facility and cancel codes are ignored and ACKed; mailbox is not blocked.
- Communities without FHIR still get HL7-only patient/service writes.
- ALIS and Yardi FHIR poll paths are unchanged.
