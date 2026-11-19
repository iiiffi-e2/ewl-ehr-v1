# Unmatched room CUID — Design

**Date:** 2026-11-18
**Status:** Approved
**Scope:** When Yardi HL7 or FHIR processes a patient whose room has no Caspio `CUID`, write under the synthetic id when that event is allowed to write, and keep one open Postgres row until staff resolve it.

## Goal

Staff can see every patient who was processed without a real room `CUID`, and mark that item resolved after the Caspio row is corrected. The app does not move the patient off the synthetic id.

## Decisions

| Topic | Choice |
| --- | --- |
| Patient write | Stay on the existing Caspio patient table. Use `COMM-{communityId}-{room}`, or `COMM-{communityId}` when the room is blank. |
| Service write | Stay on the existing Caspio service table when the event already writes a service. |
| Community row | Do not insert a community row for a synthetic `CUID`. |
| Tracking row | New Postgres table `UnmatchedCuid`. One open row per company, community, patient number, and room. |
| Resolve | Staff action on an admin page. Updates only the Postgres row. |
| Later real `CUID` | The worklist row stays open. HL7 keeps the existing patient-number fallback, so that event may write the real `CUID` onto a patient previously stored under the synthetic id. An A02 may move the service. |
| Care-plan sync | Unchanged. EyeWatch still skips when the room has no real `CUID`. |
| `missing_cuid` issue | No longer written for this case. The worklist is the record. |

## Record

`UnmatchedCuid` belongs to `Company`. Add the model to `prisma/schema.prisma` and `prisma/schema.sqlite.prisma`, with a Postgres migration.

| Field | Value |
| --- | --- |
| `companyId` | Company id |
| `communityId` | Caspio community id |
| `externalResidentId` | Patient number |
| `roomNumber` | Trimmed room. Empty string when the message has no room. |
| `source` | `yardi-hl7` or `yardi-fhir`, from the latest event |
| `firstName`, `lastName` | From the event. Null when absent. |
| `dateOfBirth` | Parsed from the event. Null when absent or unparseable. |
| `syntheticCuid` | The synthetic id for this event |
| `status` | `open` or `resolved`. Default `open`. |
| `firstSeenAt` | Set on insert. Left unchanged on later events. |
| `lastSeenAt` | Set on insert and on every later matching event |
| `lastEventType`, `lastEventMessageId` | From the latest event |
| `resolvedAt` | Set on resolve. Cleared when a later event reopens the row. |

Unique key: `companyId`, `communityId`, `externalResidentId`, `roomNumber`. Index `(communityId, status)` and `(status, lastSeenAt)` for the admin list.

The synthetic id matches `resolveEffectiveCuid`: `COMM-{communityId}-{room}` when the trimmed room is non-empty, otherwise `COMM-{communityId}`.

A repeat event for that key refreshes `source`, `syntheticCuid`, `lastSeenAt`, and the last event fields. Update `firstName`, `lastName`, and `dateOfBirth` only when this event provides a value. `firstSeenAt` stays. If the row was `resolved`, set `status` back to `open` and clear `resolvedAt`.

A write that finds a real room `CUID` does not insert, update, or close an `UnmatchedCuid` row.

If the patient number is blank, skip the worklist row and record an `EventProcessingIssue` with stage `unmatched_cuid_record_failed`.

## Write path

Record the worklist from the path that decides the Caspio patient write. HL7 records `source = yardi-hl7`. FHIR records `source = yardi-fhir`. Each event records one row.

Shadow mode and an explicit FHIR `skipCaspio` never reach the patient write, so they do not open a row.

### HL7

`getRequiredEnrichment` returns a real `CUID` when `getCommunityEnrichment` has one. Otherwise it returns the synthetic id and does not record `missing_cuid`.

A lookup by patient number must not copy a synthetic `CUID` onto a Caspio row that already has a different `CUID`, except for A02.

| Trigger | Caspio | Worklist |
| --- | --- | --- |
| A01 | Upsert the patient and open the service on patient number plus the synthetic `CUID`. | After the write succeeds. |
| A05 | Update the row keyed by patient number plus the synthetic `CUID`. If that row is missing, insert one. Leave any row with a different `CUID` unchanged. | After the write succeeds. |
| A02 | Keep the current transfer. The synthetic id is the destination, including when the existing patient was found by patient number under a different `CUID`. | After the patient update succeeds. A non-throwing issue such as `service_not_found` still leaves the row to be recorded. |
| A08, A60 | Update only a row already on that synthetic `CUID`. If the only row has a different `CUID`, leave it unchanged and do not record `patient_not_found`. If no patient exists for that patient number, record `patient_not_found` as today. | After the update succeeds, or after the deliberate skip. |
| A03, A21, A22 | Apply the existing update only when the patient row is already on that synthetic `CUID`. If the patient exists only under a different `CUID`, skip Caspio and do not record `patient_not_found`. If the patient does not exist, record `patient_not_found` as today. | After the update succeeds, or after the deliberate skip. |

If a Caspio write throws, do not write the worklist row. The event fails as it does today, and a retry records the row after the patient write succeeds.

### FHIR

`buildYardiFhirCaspioRecords` already chooses the synthetic id. After `pushYardiFhirCaspioRecords` writes the patient, a synthetic id upserts `UnmatchedCuid`. The community insert stays skipped for that id. The event type and message id come from the canonical event on the resident bundle (`yardi.poll.sync` and the existing `yardi-poll-...` id for a poll).

A later pull that finds a real room `CUID` may replace the `CUID` on that patient row. It leaves the worklist row open.

### Worklist failure

If the `UnmatchedCuid` write throws after Caspio has succeeded, or after a deliberate skip, log the error and record an `EventProcessingIssue` with stage `unmatched_cuid_record_failed`. The event still succeeds. Caspio is not retried for that failure.

## Review page

`/admin/unmatched-cuids` uses the same admin basic auth as the other admin pages and redirects to `public/unmatched-cuids.html`.

The page lists rows with community id, patient number, name, room, synthetic `CUID`, source, first seen, last seen, and last event type. Filters are `status` (`open`, `resolved`, or `all`; default `open`) and community id. Order is `lastSeenAt` descending.

`GET /admin/unmatched-cuids/rows` returns that list as JSON. The page route stays a redirect, so the list has its own path. An unknown `status` value returns 400. A `communityId` that is present and not an integer returns 400.

`POST /admin/unmatched-cuids/:id/resolve` sets `status` to `resolved` and `resolvedAt` to the current time. A missing id returns 404. Resolving a row that is already resolved returns the row unchanged. The action does not call Caspio.

The HL7 admin tester stops reporting `missing_cuid` for this case. When the run opens or refreshes an `UnmatchedCuid` row, the result includes `syntheticCuid`.

## Docs

Update `docs/yardi-community-setup.md` in the two places that describe a missing room `CUID`:

- HL7 writes the patient under the synthetic `CUID` and opens an `UnmatchedCuid` row. It does not skip the patient write.
- FHIR behavior for the synthetic id and the skipped community insert stays, and the same Postgres row is opened.
- The monitor table no longer lists `missing_cuid` as the result for a room with no `CUID`. Point that case at `/admin/unmatched-cuids`.

## Tests

- HL7 A01 with no room `CUID` writes the patient and service under `COMM-{communityId}-{room}` and inserts one open row. A second event for that patient and room updates `lastSeenAt` and leaves a single row.
- HL7 A01 with a real `CUID` writes the patient and does not insert a row.
- HL7 A05 with no room `CUID` inserts on the synthetic key and does not change an existing row that has a different `CUID`.
- HL7 A02 into an unmatched room moves the patient onto the synthetic `CUID` and opens the row.
- HL7 A08 whose only Caspio row has a different `CUID` leaves that row alone, does not record `patient_not_found`, and opens the worklist row.
- HL7 A08 with no Caspio patient records `patient_not_found` and opens the worklist row.
- HL7 A03, A21, and A22 update a patient only when that patient is already on the synthetic `CUID`. A patient who exists only under a different `CUID` is left unchanged and does not get `patient_not_found`. A missing patient still records `patient_not_found`. Both outcomes open the worklist row.
- A resolved row returns to `open` with `resolvedAt` cleared when another event for that key still has no real room `CUID`.
- FHIR synthetic push upserts the worklist row and skips the community insert. A push that finds a real `CUID` does not open a row.
- A thrown Caspio write does not insert a worklist row.
- A thrown worklist write after a successful Caspio write records `unmatched_cuid_record_failed` and the event still succeeds.
- Resolve sets `resolved` and `resolvedAt` and does not call Caspio. Resolving again is unchanged. An unknown id returns 404.
- The list defaults to open rows, filters by status and community id, and rejects an unknown status.

## Out of scope

- A separate job that searches for synthetic patients and moves them onto a real `CUID`. The existing HL7 patient-number fallback is unchanged.
- Closing the worklist row because a later event found a real room `CUID`.
- Changing EyeWatch care-plan sync.
- Inserting a Caspio community row for a synthetic `CUID`.
