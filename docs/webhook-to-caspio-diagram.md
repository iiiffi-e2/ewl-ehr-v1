# Webhook to Caspio Data Flow

```mermaid
flowchart TD
  A[ALIS Webhook Event] --> B[POST /webhook/alis]
  B --> C[Auth + Payload Validation]
  C --> D[Upsert/read PostgreSQL Company]
  D --> E[Insert PostgreSQL EventLog status=received]
  E --> F{Duplicate EventMessageId?}

  F -- Yes --> G[Return 200 duplicate]
  F -- No --> H{Supported event type?}

  H -- No --> I[Update PostgreSQL EventLog status=ignored]
  H -- Yes --> J[Queue Job in Redis]

  J --> K[Worker consumes job]
  K --> L[Fetch resident data from ALIS API]
  L --> M[Upsert PostgreSQL Resident]
  M --> N[Read Caspio CarePatientTable_API for lookup]
  N --> O[Transform to Caspio schema]
  O --> P[Upsert Caspio CommunityTable_API]
  P --> Q[Upsert Caspio CarePatientTable_API]
  Q --> R[Upsert Caspio Service_Table_API]

  R --> S[Update PostgreSQL EventLog status=processed]
  S --> T[Return 202 accepted]

  classDef success fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20;
  classDef warning fill:#fff8e1,stroke:#ef6c00,color:#e65100;
  class G,I warning;
  class P,Q,R,S,T success;
```

## Exact tables/models used

- PostgreSQL reads/writes:
  - `Company` (upsert/read by `companyKey`)
  - `EventLog` (insert `received`, update `queued|processed|ignored|failed`)
  - `Resident` (upsert by `alisResidentId`)
- Caspio reads/writes:
  - `CarePatientTable_API` via `CASPIO_TABLE_NAME` (lookup + upsert)
  - `CommunityTable_API` via `CASPIO_COMMUNITY_TABLE_NAME` (upsert)
  - `Service_Table_API` via `CASPIO_SERVICE_TABLE_NAME` (upsert)
- Table names above are the current defaults and can be overridden by env vars.
