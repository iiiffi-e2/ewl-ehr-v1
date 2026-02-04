# ALIS Credentials Management

This service stores per-company ALIS API credentials in the database, encrypted
with a master key.

## Setup

1. Set `ALIS_CREDENTIALS_MASTER_KEY` in your environment.
   - Must be 32 bytes, base64-encoded.
   - Example generation:
     - `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Run migrations:
   - `npm run prisma:migrate`

## Add or update a company's ALIS credentials

### Option A: Admin API (recommended)

Endpoint:

- `POST /admin/alis-credentials`

Body:

```json
{
  "companyKey": "ACME_CORP",
  "username": "alis-api-user",
  "password": "alis-api-pass"
}
```

Response:

```json
{
  "success": true,
  "companyId": 123,
  "username": "alis-api-user",
  "timestamp": "2026-02-04T12:00:00.000Z"
}
```

### Option B: CLI

Run from repo root:

- `tsx scripts/upsert-alis-credential.ts --companyKey ACME_CORP --username alis-api-user --password alis-api-pass`

## Rotation

Re-run either the API or CLI with the new password. The record is upserted
by `companyId`.

## Fallback behavior

If no credentials are stored for a company, the system uses
`ALIS_TEST_USERNAME` and `ALIS_TEST_PASSWORD`. This is logged as a warning.
