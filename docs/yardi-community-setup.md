# Add a Yardi community

Use this when connecting a new Yardi facility to an environment (staging or production). One operator has one Postgres company. Each facility has its own Caspio community id, HL7 facility id, and FHIR organization id.

Do the Postgres and Caspio steps in the database for **that environment**. Staging and production do not share a database.

## Values you need

Collect these before changing configuration.

| Value | Example | Where it goes |
| --- | --- | --- |
| Company key | `3rivers` | Postgres `Company.companyKey`, and the first field of both rosters |
| Community id | `501` | A number you choose. Caspio `CommunityID`, and the second field of both rosters |
| HL7 facility id | `CRKTHREE` | Third field of `YARDI_HL7_POLL_TARGETS`. The poller also sends this id as the mailbox external facility id |
| FHIR organization id | `237-1` | Third field of `YARDI_FHIR_POLL_TARGETS` only |
| Community name | `Creekside Three Rivers` | Caspio `CommunityName` |
| Room numbers | from the facility or from a FHIR read | One Caspio row per room |

The company key is the operator, not the facility. Every facility for that operator reuses the same key. `CRKTHREE` is not a company key and not an organization id.

Each roster facility id is its own Yardi mailbox. The poller sends that id as the external facility id on GetMessage (MSH-6) and ProcessACK. The password and the other MSH ids stay the same. `YARDI_HL7_SENDING_FACILITY` is used only when the roster is empty.

## 1. Postgres

Postgres has no community table. The only row you add by hand is the operator, and only if that company key is not already there.

Connect to the environment's `DATABASE_URL` and check:

```sql
SELECT id, "companyKey", name FROM "Company" WHERE "companyKey" = '3rivers';
```

The column name is case-sensitive. `3Rivers` does not match `3rivers`. A value stored in `name` does not count.

Insert it when the query returns no row:

```sql
INSERT INTO "Company" ("companyKey", name)
VALUES ('3rivers', 'Three Rivers');
```

The FHIR pull looks this row up and stops with `Company not found` when it is missing. HL7 creates the row on the first event, but create it here so both paths use the same key.

Residents and events are written by the app. Do not insert those.

## 2. Choose the Caspio community id

In that environment's Caspio account, open `CommunityTable_API` and pick a numeric `CommunityID` that is not already used. Use that same number on every room row and in both roster variables.

## 3. Caspio rooms

`CommunityTable_API` is one row per room, not one row per facility. Add a row for each room you want HL7 or FHIR to attach to a real `CUID`.

| Field | Value |
| --- | --- |
| `CommunityID` | The number from step 2, same on every row |
| `CommunityName` | Community name, same on every row |
| `RoomNumber` | The room string Yardi sends |
| `CUID` | Unique for that room |

`CUID` is unique per room. The app does not assign a real one. Leave patient, service, and off-prem rows empty. Those are created by a later write.

Until a room row exists:

- HL7 stores the event and skips the Caspio write (`missing_cuid`).
- FHIR still writes the patient, with a synthetic id `COMM-{communityId}-{room}`, and does not insert the community row.

If you do not yet know the rooms, you can add the roster in step 4 and wait to create room rows. Live HL7 events for unknown rooms will be stored and skipped until the row exists.

### Finding rooms from FHIR

Skip this when the facility already gave you the room list.

Organization id is required. Facility id cannot be used here.

1. Open `https://<host>/admin/yardi-fhir-test` and sign in with that environment's `WEBHOOK_BASIC_USER` and `WEBHOOK_BASIC_PASS`.
2. Run **Test Auth Token**. The environment must already have `YARDI_FHIR_TOKEN_URL`, `YARDI_FHIR_API_BASE_URL`, `YARDI_FHIR_CLIENT_ID`, and `YARDI_FHIR_CLIENT_SECRET`.
3. In **FHIR Request**, send `GET /Organization` with `{ "_count": "400" }`. Use the `id` on the organization with this community's name.
4. Send `GET /Patient` with `{ "organization": "<that id>", "active": "true", "_count": "400" }`. That list is limited to the organization.

**Run Yardi Pull** also adds every patient with an encounter since the last cursor, from every facility on the FHIR connection. Use it to read `roomNumber` only after you can tell those extra patients apart from this community. Leave **Skip Caspio** checked. The pull requires the company key from step 1. The community id can be the number from step 2.

## 4. Environment variables

Set these on the environment and redeploy. The process reads them only at startup.

HL7, one facility:

```text
YARDI_HL7_POLL_TARGETS=3rivers:501:CRKTHREE
```

Several facilities, comma-separated. The company key stays the same:

```text
YARDI_HL7_POLL_TARGETS=3rivers:501:CRKTHREE,3rivers:502:NEXTFAC
```

FHIR uses the same shape. The third field is the organization id from step 3:

```text
YARDI_FHIR_POLL_TARGETS=3rivers:501:237-1,3rivers:502:240-1
```

Use the JSON form when an id contains a colon:

```text
[{"companyKey":"3rivers","communityId":501,"facilityId":"CRKTHREE"}]
```

```text
[{"companyKey":"3rivers","communityId":501,"organizationId":"237-1"}]
```

Append a new facility to the existing value. Replacing the value drops the facilities that were already listed.

If `EHR_ENABLED_COMMUNITY_IDS` is set, add the new community id to that comma-separated list. When the list is non-empty, every community not on it is skipped. Leave the variable empty to allow every community.

Leave the pollers off until you intend them to run:

```text
YARDI_HL7_POLL_ENABLED=false
YARDI_FHIR_POLL_ENABLED=false
```

`YARDI_HL7_POLL_ENABLED=true` drains each roster mailbox and acknowledges each message it downloads. Staging and production must not poll the same facility mailbox. An acknowledgement removes the message for the other environment.

A live facility uses the production broker, not the QA default:

```text
YARDI_HL7_GET_MESSAGE_URL=https://yardimirthus.com:1021/HL7/GetMessage
YARDI_HL7_PROCESS_ACK_URL=https://yardimirthus.com:1024/HL7/ProcessACK/
```

Yardi must whitelist this environment's outbound IP, and `YARDI_HL7_MAILBOX_PASSWORD` must be set, before the poller can download messages.

## 5. Confirm the rosters loaded

Sign in with the same basic-auth user as the admin pages.

`GET /admin/yardi-hl7-poll/config`

Each facility id should appear with the company key and community id you set.

`GET /admin/yardi-fhir-sync/config`

Each organization id should appear with the same company key and community id. Skip this check when you are not enabling FHIR for the facility. Leave that facility off `YARDI_FHIR_POLL_TARGETS`. HL7 then writes from the ADT message only.

An HL7-only write includes patient number, name, date of birth, room, `CUID`, and community name. Service type is `Unassigned`. Insurance, contacts, diagnoses, and address stay blank until the facility is also on the FHIR roster.

## 6. Test HL7 without the mailbox

Open `/admin/yardi-hl7-test`. This page does not acknowledge the Yardi mailbox.

Build an ADT:

- Trigger `A01`
- Facility: the HL7 facility id, such as `CRKTHREE`
- Resident ID: a test id
- Room: a room you added in Caspio
- Name and date of birth

Leave **Dry-run** unchecked to write Caspio. Confirm the patient in `CarePatientTable_API` and a service row in `Service_Table_API`.

On `/monitor`, source `yardi-hl7`:

| Result | Meaning |
| --- | --- |
| `unknown_facility` | Facility id is not on the HL7 roster the app loaded |
| `missing_cuid` | That room has no Caspio row with a `CUID` |
| `ehr_community_not_enabled` | Community id is missing from `EHR_ENABLED_COMMUNITY_IDS` |
| `ehr_shadow_mode` | `EHR_SHADOW_MODE` is true, so Caspio was not written |

`EHR_SHADOW_MODE=true` skips the Caspio write for HL7. Turn it off on this environment when the test should write.

## 7. Test FHIR

Skip this until the facility has an organization id and is on `YARDI_FHIR_POLL_TARGETS`.

On `/admin/yardi-fhir-test`, **Run Yardi Pull** with:

- Company Key: the Postgres company key
- Community ID: the Caspio community id
- Organization ID: this facility's organization id
- **Skip Caspio** checked for the first run

The first run saves residents in Postgres only. Uncheck **Skip Caspio** only after the environment's `CASPIO_*` variables point at the Caspio account you mean to write.

Keep `YARDI_FHIR_POLL_ENABLED` false unless this environment should poll on a schedule.
