# Yardi handling

Yardi reaches this app on two paths. They do not share a workflow.

- **HL7 ADT** is event-driven. A poller drains Yardi's mailbox, and each supported trigger writes a specific Caspio change (move-in, room transfer, move-out, leave, or patient update).
- **FHIR** is a snapshot sync. A poller pulls current patients and writes demographics, insurance, contacts, and diagnoses. It also opens or closes EyeWatch Detect / Intervene service rows from active care plans.

HL7 wins for room, resident id, and event time when both sources are present on the same event. FHIR fills the rest.

## HL7 ADT events

The HL7 poller calls Yardi GetMessage, parses the ADT message, matches the facility to `YARDI_HL7_POLL_TARGETS` (`companyKey:communityId:facilityId`), and stores the event. Facility match uses MSH sending facility, then PV1 facility if MSH is empty.

Supported triggers are enqueued and processed by `handleYardiHl7Event`. Unknown facilities are stored and ignored (`unknown_facility`). Unsupported triggers are stored and ignored (`unsupported_trigger`). Duplicates are acknowledged and are not processed again unless the earlier copy never left `received`. A successful persist is always ACKed. A persist or enqueue failure is not ACKed, so Yardi can redeliver.

CUID comes from the Caspio community table for that community and PV1 room (`PV1-3.2`). If that room row has no CUID, the event is recorded as a non-retryable issue and no Caspio write happens. Event workflows do not invent a CUID.

If the same company and community are also on `YARDI_FHIR_POLL_TARGETS`, the worker fetches the FHIR patient bundle and uses it for insurance, contacts, diagnoses, and address. HL7 still supplies the trigger, room, resident id, name, date of birth, and event timestamp. A FHIR failure is logged and the write continues from HL7 fields only.

Service type on HL7 writes is the FHIR encounter type when that overlay is present. Otherwise the service type is `Unassigned`.

| Trigger | Event type | What it means | What we write |
| --- | --- | --- | --- |
| A01 | `hl7.adt.a01` | Move-in | Upsert the patient on PatientNumber + CUID. Set move-in date, service start, and on-prem. Open a service row. |
| A02 | `hl7.adt.a02` | Room transfer | Treat the PV1 room as the new room. Close the open service on the previous CUID and open one on the new room CUID. Patch the patient with the new room and CUID. |
| A03 | `hl7.adt.a03` | Move-out | Set move-out date, service end date, and on-prem false. Close the active service. |
| A05 | `hl7.adt.a05` | New resident / pre-admit | Same patient patch as an update. If the resident is missing, insert the patient and open a service. |
| A08 | `hl7.adt.a08` | Patient update | Patch the existing patient (room, name, date of birth, and FHIR fields when present). Skip if the resident is missing. |
| A21 | `hl7.adt.a21` | Leave start | Set off-prem, clear on-prem, and open an off-prem history episode. |
| A22 | `hl7.adt.a22` | Leave end | Close the open off-prem episode and set the patient back on-prem. |
| A60 | `hl7.adt.a60` | Patient update | Same as A08. |

### A02 room transfer

1. Resolve the new room's CUID from community enrichment.
2. Find the existing patient, first by PatientNumber + new CUID, then by PatientNumber alone.
3. If the patient row still has a different CUID, close the service on that previous CUID. If the patient row already has the new CUID, look up the latest service by patient number and close it when that service CUID is still the old one.
4. Open a service on the new CUID with the event datetime as the start date.
5. Update the patient row to the new room and CUID.

If the previous service row cannot be found, the transfer is recorded as `service_not_found` and a new service is still opened. If the resident is not in Caspio, the event is skipped (`patient_not_found`).

### A01, A03, and leave

A01 always upserts. It does not require an existing patient.

A03, A21, and A22 require an existing patient. A missing patient is recorded as `patient_not_found` and the write is skipped. A03 also records `service_not_found` when the patient is updated but no service row can be closed. A22 records `open_off_prem_episode_not_found` when there is no open episode to close; the patient is still marked on-prem.

### Patient fields on an HL7 write

From HL7 alone: PatientNumber, first name, last name, date of birth, room number, CUID, and community name.

When a FHIR bundle is attached, the same field set as the FHIR patient sync is used (address, phone, two insurance slots, two family contacts, two diagnoses, apartment number). Move-in is the only HL7 path that also writes move-in date, service start, and on-prem from the event. Updates strip those presence flags so an A02, A05, A08, or A60 does not overwrite leave or move-in state from the FHIR encounter.

### Triggers we store and do not act on

These are labeled but not in the supported set. They are ignored and ACKed. They do not call Caspio.

| Trigger | Label |
| --- | --- |
| A11 | Cancel admit |
| A12 | Cancel transfer |
| A13 | Cancel discharge |
| A38 | Cancel leave |

Any other ADT trigger is ignored the same way.

## FHIR sync

The FHIR poller runs on `YARDI_FHIR_POLL_TARGETS` (`companyKey`, Caspio `communityId`, Yardi `organizationId`). For each target it loads active patients for that organization, plus patients with an encounter since the last poll. Each patient is then:

1. Fetched as Patient, latest Encounter, Coverage, and active Conditions.
2. Upserted into the local Resident table (`source: yardi-fhir`).
3. Pushed to Caspio, unless shadow mode is on for a non-Yardi source or the job asked to skip Caspio.
4. Checked for an EyeWatch care plan, which may open or close a Detect or Intervene service row.

A patient failure is logged and the poll continues. The cursor advances after the target finishes.

Room comes from the latest encounter location. Encounter status `in-progress` is on-prem. Encounter status `onleave` is off-prem. Encounter type is stored as both product type and classification.

CUID prefers the Caspio room row. If that row is missing, the FHIR sync uses a synthetic id `COMM-{communityId}-{room}` (or `COMM-{communityId}` with no room). A synthetic CUID is written on the patient only. The community table is updated only when the CUID is a real room row.

The scheduled FHIR poll does **not** open the generic classification service row. That write is off unless a caller explicitly sets `skipService` to false. EyeWatch Detect / Intervene rows are a separate step and still run.

### Caspio patient fields from FHIR

PatientNumber, name, date of birth, room and apartment number, address, phone, primary and secondary insurance (name, number, group, type), two family contacts (name, relationship, phone, email, address), Diagnosis1 and Diagnosis2, move-in date, on-prem / off-prem and their dates, CUID, and community name.

Upsert key for the patient on this path is PatientNumber.

### EyeWatch care plans

After the patient push, the sync reads active CarePlans in the `assess-plan` category.

An activity counts as EyeWatch when its reason is `eyewatch monitoring` or its code text contains `eyewatch`. The level is taken from that code text:

- `intervene` → service type `Intervene`
- `detect` → service type `Detect`
- both present → `Intervene` wins

Then, on the patient's room CUID:

| Care plan | Open EyeWatch rows | Action |
| --- | --- | --- |
| Detect or Intervene, and that type is not already open | Other EyeWatch type open, or none | Close the other type and open the incoming type |
| Detect or Intervene already open | Same type | Leave it |
| No Detect or Intervene level | Open Detect or Intervene rows | Close them |
| Monitoring text with no Detect or Intervene level | Any | Leave service rows unchanged and log that the level is unknown |

Missing room or missing Caspio room CUID skips the care-plan write. A care-plan failure does not fail the patient sync.

## FHIR webhook

`POST /webhook/yardi/fhir` accepts a payload with company, community, event type, message id, and a patient id in notification data. It fetches the current FHIR bundle and pushes the same Caspio patient record as the poll. A `RoomNumber` on the webhook overrides the encounter room. This path does not run the HL7 trigger workflows and does not run the care-plan service sync.

## What we do not do

- Send HL7 back to Yardi (`SendMessage` is unused).
- Apply cancel events (A11, A12, A13, A38).
- Move a resident between rooms from the FHIR poll. A room change is the HL7 A02 path. The FHIR poll overwrites the patient room on the current PatientNumber row.
- Use the ALIS orchestrator for Yardi events.
