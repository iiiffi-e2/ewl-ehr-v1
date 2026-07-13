# Yardi HL7 Restful Message Broker Poller — Design

**Date:** 2026-07-13  
**Status:** Approved  
**Scope:** Capture-only poller for Yardi HL7 ADT via Restful Message Broker (GetMessage + ProcessACK). No Caspio push.

**Supersedes (transport):** The push-webhook design in `2026-07-09-yardi-hl7-adt-capture-listener-design.md` assumed Yardi POSTs to our API. The Restful Message Broker spec defines a **pull** model instead. This document is the source of truth for transport going forward.

## Goal

Poll Yardi’s HL7 Restful Message Broker for outbound ADT messages, persist them in EventLog for `/monitor` inspection, acknowledge delivery via ProcessACK, and do not enqueue Caspio processing.

## Yardi interface identity

| Field | Value | Notes |
|-------|--------|--------|
| Application / ExternalAppID | `Yardi` | MSH sending or receiving depending on message direction |
| Facility / ExternalFacilityID | `EYELIVE` | |
| Software / ExternalSoftwareID | `EyeWatchLive` | Pharmacy side |
| Pharmacy / ExternalPharmacyID | `EyeWatchLive` | |
| Mailbox password (MSH.8.1) | From env `YARDI_HL7_MAILBOX_PASSWORD` | Provided by Yardi; never commit |

ADT content (triggers A01, A02, A03, A05, A08, A11–A13, A21, A22, A38, A60) remains as in the HL7 ADT Interface Specifications.

## Broker endpoints (configurable)

| Purpose | QA (default) | Production |
|---------|--------------|------------|
| GetMessage | `https://test.yardimirthus.com:1021/HL7/GetMessage` | `https://yardimirthus.com:1021/HL7/GetMessage` |
| ProcessACK | `https://test.yardimirthus.com:1024/HL7/ProcessACK/` | `https://yardimirthus.com:1024/HL7/ProcessACK/` |

SendMessage (pharmacy → Yardi) is **out of scope** for this phase.

**Auth:** No HTTP BasicAuth for the broker. Security is MSH.8.1 password + Yardi-side IP whitelist of our egress IPs.

**Content-Type:** `text/xml` for GetMessage and ProcessACK.

## Decisions

| Topic | Choice |
|-------|--------|
| Transport | Poll GetMessage (not inbound webhook) |
| Schedule | BullMQ repeatable job (~5 minutes), mirror Yardi FHIR poll |
| After download | Always ProcessACK success on successful capture (or duplicate) |
| Environment | URLs via env; default to QA |
| Push webhook | **Remove** `POST /webhook/yardi/hl7` and text body middleware |
| Processing | Capture-only: EventLog + `markEventIgnored(..., 'capture_only')`; no Caspio |
| Company mapping | Defer; placeholder `CompanyKey` `yardi`, `CommunityId` null |
| Monitor | Existing `/monitor` + source badge `yardi-hl7` |

## Architecture

```
BullMQ schedule (YARDI_HL7_POLL_INTERVAL_MS, default 300000)
        │
        ▼
POST GetMessage (text/xml, QBP^Q11, MSH.8.1 password)
        │
        ├─ empty (MSA|CR) → end cycle
        ├─ broker/HTTP error → log, fail job / next cycle
        └─ HL7 ADT in <response>
                │
                ▼
        YardiHl7AdtAdapter.parseInboundEvent(rawAdt)
                │
                ▼
        recordIncomingEvent → markEventIgnored(..., 'capture_only')
                │
                ▼
        POST ProcessACK (XML success) to Yardi
                │
                ▼
        repeat GetMessage until empty (cap per tick, e.g. 50)
```

## Components

### 1. Broker client — `src/integrations/yardi/yardiHl7BrokerClient.ts`

Responsibilities:

- Build GetMessage request body: XML `<HL7MessageBroker><request>…escaped HL7…</request></HL7MessageBroker>` with QBP^Q11 and MSH.8.1 password.
- `getMessage()` → POST → parse response XML → classify:
  - `adt` — raw HL7 ADT string from `<response>`
  - `empty` — no-messages ACK (`MSA|CR`)
  - `error` — failure ACK (`MSA|CE`) or non-success HTTP
- `processAck(adtMessage)` → build ProcessACK XML per broker spec (`Message` / `ADTQueue` / Pharmacy / PharmacyPropertyComm / Response with AckCode `0`) and POST to ProcessACK URL.

Interface IDs and password come from env/config, not hardcoded secrets.

### 2. Poll worker + queue

Mirror `yardiFhirPoll`:

- Queue name e.g. `yardi-hl7-poll`
- `YARDI_HL7_POLL_ENABLED` gates schedule registration
- Worker drains mailbox each tick: GetMessage → capture → ProcessACK → until empty or max messages per tick
- Concurrency 1

### 3. Capture path (reuse)

- Parse ADT with existing `YardiHl7AdtAdapter` raw-string path
- Persist via `recordIncomingEvent`
- `markEventIgnored` with reason `capture_only`
- Do **not** enqueue `process-alis-event` / Caspio

Duplicates: treat as success for ProcessACK (message already captured; clear Yardi queue).

### 4. Remove push webhook

- Unmount/remove `POST /webhook/yardi/hl7`
- Remove `parseYardiHl7Body` middleware (if unused)
- Update/remove webhook HTTP tests that targeted that route
- Keep `hl7Ack.ts` and adapter for parsing / ACK-related helpers as needed by ProcessACK

### 5. Configuration (`env.ts` + `.env.example`)

| Variable | Purpose |
|----------|---------|
| `YARDI_HL7_POLL_ENABLED` | Enable schedule (default false) |
| `YARDI_HL7_POLL_INTERVAL_MS` | Default `300000` |
| `YARDI_HL7_GET_MESSAGE_URL` | Default QA GetMessage URL |
| `YARDI_HL7_PROCESS_ACK_URL` | Default QA ProcessACK URL |
| `YARDI_HL7_MAILBOX_PASSWORD` | MSH.8.1 (required when poll enabled) |
| `YARDI_HL7_SENDING_APPLICATION` | Default `EyeWatchLive` (pharmacy ExternalSoftwareID on GetMessage) |
| `YARDI_HL7_SENDING_FACILITY` | Default `EyeWatchLive` |
| `YARDI_HL7_RECEIVING_APPLICATION` | Default `Yardi` |
| `YARDI_HL7_RECEIVING_FACILITY` | Default `EYELIVE` |
| `YARDI_HL7_POLL_MAX_MESSAGES` | Cap per tick (e.g. 50) |

Exact MSH direction for GetMessage request must match broker samples (pharmacy as sender, Yardi as receiver on the QBP). Implement against the Restful Message Broker sample fields.

## Error handling

| Condition | Behavior |
|-----------|----------|
| GetMessage HTTP/network failure | Log; fail job (retry / next schedule) |
| Broker error response (`MSA|CE` etc.) | Log; do not ProcessACK success |
| Unparseable ADT in response | Log; do not treat as successful capture; do not ProcessACK success |
| Persist failure | Log; do not ProcessACK success |
| Duplicate event | ProcessACK success anyway |
| ProcessACK failure after capture | Log warning; next GetMessage may redeliver — EventLog dedupe handles it |

## Out of scope

- Caspio / downstream push for HL7
- `SendMessage` (inbound to Yardi)
- Facility → company/community mapping
- Keeping the push webhook endpoint

## Testing

- Unit: GetMessage request XML includes password and interface IDs
- Unit: parse GetMessage responses (ADT / empty / error)
- Unit: ProcessACK XML shape from sample ADT
- Unit/integration: poll tick captures to EventLog with `capture_only`, no queue enqueue
- Confirm `/webhook/yardi/hl7` is removed (route/tests)

## Ready-for-Yardi checklist

1. Provide our static egress IPs for their whitelist  
2. Set env: mailbox password, QA (or prod) URLs, poll enabled  
3. Deploy worker with poller registered  
4. Ask Yardi to queue a test ADT  
5. Confirm message appears on `/monitor` as `yardi-hl7` within one poll interval  

## Success criteria

- Poller retrieves ADT from GetMessage and stores EventLog rows visible in `/monitor`
- ProcessACK is sent after successful capture (and duplicates)
- No Caspio enqueue for these events
- Push webhook path removed
- ALIS and Yardi FHIR behavior unchanged
