# Yardi HL7 ADT Capture Listener — Design

**Date:** 2026-07-09  
**Status:** Approved  
**Scope:** Capture-only webhook listener for Yardi HL7 ADT events (no Caspio push)

## Goal

Accept Yardi’s HL7 ADT test messages on the existing webhook path, persist them for inspection in the webhook monitor, and acknowledge receipt — without enqueueing BullMQ jobs or writing to Caspio.

Yardi-provided interface IDs:

| MSH field | Role | Value |
|-----------|------|-------|
| MSH.3.1 | Application ID (sending) | `Yardi` |
| MSH.4.1 | Facility ID (sending) | `EYELIVE` |
| MSH.5.1 | Software ID (receiving) | `EyeWatchLive` |
| MSH.6.1 | Pharmacy ID (receiving) | `EyeWatchLive` |

## Context

The codebase already has:

- `POST /webhook/yardi/hl7` → `handleWebhookBySource('yardi-hl7', …)`
- `YardiHl7AdtAdapter` (JSON envelope with `Message` + ALIS-like metadata)
- EventLog persistence + `/monitor` UI
- No Caspio orchestrator for `yardi-hl7` yet

Gaps for Yardi’s real interface:

1. Ingress expects JSON; Yardi may send raw HL7 text.
2. Successful parse currently enqueues the shared worker (undesired for this phase).
3. No HL7 ACK response.

## Decisions

| Topic | Choice |
|-------|--------|
| Endpoint | Extend existing `POST /webhook/yardi/hl7` |
| Body formats | Raw HL7 **and** existing JSON envelope |
| Processing | Persist + ACK only; **do not enqueue** |
| ACK | Dual: HL7 ACK for raw; JSON for JSON |
| Company mapping | Defer; use generic placeholder `CompanyKey` (e.g. `yardi`), `CommunityId = null` |
| Monitor | Reuse existing `/monitor` / admin webhook-events APIs |

## Architecture

```
Yardi
  │
  ▼
POST /webhook/yardi/hl7  (BasicAuth + optional IP allowlist)
  │
  ├─ raw HL7 string  ─┐
  └─ JSON envelope   ─┴─► YardiHl7AdtAdapter.parseInboundEvent()
                              │
                              ▼
                        recordIncomingEvent() → EventLog
                              │
                              ├─ mark capture_only (no BullMQ enqueue)
                              │
                              └─ ACK
                                   ├─ raw → MSA|AA|… (or AE/AR)
                                   └─ JSON → 202 { status: 'received', id }
```

ALIS and Yardi FHIR webhook paths are unchanged.

## Components

### 1. Body parsing

Today `express.json()` only accepts JSON. Add middleware (route-scoped or app-level with a type filter) so `/webhook/yardi/hl7` can receive:

- `text/plain`, `application/hl7-v2`, `application/hl7-v2+er7`, or similar
- Bodies that are already a string starting with `MSH|`

JSON posts continue to work as today.

### 2. Adapter (`yardiHl7AdtAdapter.ts`)

`parseInboundEvent` accepts:

1. **Raw HL7 string** — parse MSH/EVN/PID/PV1; build `CanonicalInboundEvent`
2. **Existing JSON schema** — `CompanyKey`, `EventMessageId`, `EventMessageDate`, `Message`, optional `CommunityId` / `EventType` / `NotificationData`

For raw HL7:

| Canonical field | Source |
|-----------------|--------|
| `source` | `yardi-hl7` |
| `companyKey` | Placeholder `yardi` (facility→company mapping deferred) |
| `communityId` | `null` |
| `eventMessageId` | MSH.10 |
| `eventMessageDate` | MSH.7 (normalized to ISO when possible) |
| `eventType` | `hl7.adt.{trigger}` (e.g. `hl7.adt.a01`) |
| `lifecycleKind` | Existing `toLifecycle()` mapping |
| `notificationData` | Include `TriggerEvent`, `ResidentId`, and MSH.3–6 for verification |
| `raw` | Full message + parsed summary |

Supported ADT triggers (per Yardi spec; adapter already maps the main lifecycle set): A01, A02, A03, A05, A08, A11, A12, A13, A21, A22, A38, A60. Unsupported/unknown triggers still persist with `lifecycleKind: unknown` for capture visibility.

### 3. Capture-only gate (`handler.ts`)

After a successful `recordIncomingEvent` for `yardi-hl7`:

1. Do **not** call `processAlisEventQueue.add`
2. Call `markEventIgnored(..., 'capture_only')` so the event is not left in a pending/queued state
3. Return the dual ACK (`received` for first capture; existing duplicate handling below)

Duplicates: still return success without enqueueing (JSON `duplicate` / HL7 ACK AA).

ALIS and `yardi-fhir` keep current enqueue behavior.

### 4. HL7 ACK helper

Minimal v2 ACK derived from inbound MSH:

- Swap sending/receiving application and facility fields appropriately
- Success: `MSA|AA|{controlId}`
- Validation failure: `MSA|AE|{controlId}` (HTTP 400)
- Server/persist failure: `MSA|AR|{controlId}` (HTTP 500)

JSON clients receive existing-style JSON bodies (`received`, `duplicate`, `error`).

### 5. Monitoring

No new UI required for v1. Events appear as `source: yardi-hl7` in:

- `GET /admin/webhook-events`
- `GET /admin/webhook-events-stream`
- `/monitor`

Operators can confirm MSH IDs and trigger type from stored payload / notification data.

## Error handling

| Condition | HTTP | ACK / body |
|-----------|------|------------|
| Auth failure | 401 / 403 | Existing JSON errors |
| Unparseable / non-HL7 body | 400 | HL7 `MSA\|AE` or JSON error |
| Duplicate event | 200 | JSON `duplicate` or HL7 `MSA\|AA` |
| Persist failure | 500 | HL7 `MSA\|AR` or JSON error |

## Out of scope

- Caspio / downstream push for HL7
- Facility (`MSH.4.1`) → `CompanyKey` / `CommunityId` config map
- BullMQ worker resident upsert for HL7
- New monitor screens or Yardi-specific admin UI
- Changing Yardi FHIR webhook or poll paths

## Testing

- Unit: raw HL7 → canonical event (MSH IDs, triggers, placeholder company key)
- Unit: JSON envelope path still parses
- Unit: ACK generation (AA / AE)
- Unit or integration: `yardi-hl7` handler does not enqueue
- Manual: POST a sample from the Yardi PDF; confirm EventLog row in `/monitor`

## Ready-for-Yardi checklist

When implemented and deployed:

1. Share URL: `https://<host>/webhook/yardi/hl7`
2. Share BasicAuth credentials (`WEBHOOK_BASIC_USER` / `WEBHOOK_BASIC_PASS`)
3. Confirm expected MSH IDs: `Yardi` / `EYELIVE` / `EyeWatchLive` / `EyeWatchLive`
4. Ask Yardi to send a test ADT; verify in `/monitor`

## Success criteria

- A raw HL7 ADT POST to `/webhook/yardi/hl7` is stored in EventLog and visible in the monitor
- Response is an HL7 ACK (raw) or JSON `received` (JSON)
- No BullMQ job is created for `yardi-hl7` in this phase
- ALIS and Yardi FHIR behavior unchanged
