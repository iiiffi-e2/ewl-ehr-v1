# ALIS → EyeWatch LIVE® Integration Service

Production-ready Node.js service that receives ALIS webhook events, normalises resident ADT data, persists state in PostgreSQL/SQLite via Prisma, and forwards updates to Caspio using OAuth-secured REST calls. The integration uses BullMQ/Redis for resilient background processing, Pino for structured logging, Zod for runtime contract validation, and ships with Swagger docs plus Jest/Supertest coverage.

---

## Tech Stack

- **Runtime:** Node.js 20 + TypeScript
- **Web:** Express, Helmet, BasicAuth middleware
- **Validation:** Zod
- **Persistence:** Prisma ORM → PostgreSQL (SQLite for local/dev)
- **Queue:** BullMQ + Redis (ioredis / ioredis-mock for tests)
- **Integrations:** Axios clients for ALIS + Caspio REST APIs
- **Docs & Observability:** OpenAPI/Swagger UI, Pino structured logging
- **Testing:** Jest, ts-jest (ESM), Supertest
- **Containerisation:** Docker Compose (Postgres + Redis), Dockerfile for service

---

## Project Layout

```
src/
  config/         # env parsing, logger, axios helpers
  db/             # Prisma singleton client
  docs/           # OpenAPI (Swagger) definition
  domains/        # Domain services (events, residents)
  http/           # Express app, routes, middleware
  integrations/   # ALIS & Caspio API clients + mappers
  webhook/        # Schemas + HTTP handler
  workers/        # BullMQ queue + processor + worker entrypoint
  scripts/        # Command-line utilities (resident backfill)
prisma/           # Schema + migrations (Postgres) + SQLite schema
tests/            # Jest/Supertest coverage
docker-compose.yml
Dockerfile
```

---

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Copy environment template**
   ```bash
   cp .env.example .env
   ```
   Update Caspio credentials, BasicAuth secrets, IP allowlist, etc.

3. **Database setup**

   - **Local development (SQLite):**
     ```bash
     npx prisma db push --schema=prisma/schema.sqlite.prisma
     ```
     This creates/updates `dev.db` (SQLite). Update `.env` → `DATABASE_URL=file:./dev.db`.

   - **PostgreSQL (Docker Compose):**
     ```bash
     docker-compose up -d db redis
     export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ewl"
     npx prisma migrate deploy
     ```

4. **Run services**
   ```bash
   npm run dev         # Express API in watch mode (ts-node-dev)
   npm run dev:worker  # BullMQ worker in watch mode
   ```

5. **Swagger docs**
   - `GET /docs` for Swagger UI
   - `GET /docs.json` for raw OpenAPI doc

---

## NPM Scripts

| Command                 | Purpose                                                  |
|-------------------------|----------------------------------------------------------|
| `npm run dev`           | Start HTTP server with ts-node-dev + Pino pretty logs    |
| `npm run dev:worker`    | Start BullMQ worker for `process-alis-event` jobs        |
| `npm run build`         | Type-check and emit compiled JS to `dist/`               |
| `npm start`             | Run built server (`node dist/http/server.js`)            |
| `npm run deploy`        | Run migrations + start server (production)               |
| `npm run deploy:worker` | Run migrations + start worker (production)               |
| `npm run worker`        | Run built worker (`node dist/workers/index.js`)          |
| `npm test`              | Jest + Supertest test suite                              |
| `npm run prisma:migrate`| Apply Postgres migrations (deploy mode)                  |
| `npm run prisma:migrate:dev` | Create/apply migrations in dev (Postgres)          |
| `npm run prisma:generate` | Regenerate Prisma client                              |
| `npm run backfill -- --companyKey <key> [--dryRun] [--skipCaspio]` | Backfill ALIS residents via API |
| `npm run test:communities` | Test ALIS Communities API endpoint                    |

---

## Environment Variables

Required keys (see `.env.example`):

- **Service:** `NODE_ENV`, `PORT`, `LOG_LEVEL`, `ENABLE_SWAGGER`, `PUBLIC_URL` (optional, for Swagger docs in production)
- **Database/Queue:** `DATABASE_URL`, `REDIS_URL`
- **Webhook security:** `WEBHOOK_BASIC_USER`, `WEBHOOK_BASIC_PASS`, `IP_ALLOWLIST`
- **ALIS API:** `ALIS_API_BASE`, `ALIS_TEST_USERNAME`, `ALIS_TEST_PASSWORD`
- **Caspio:** `CASPIO_TOKEN_URL`, `CASPIO_CLIENT_ID`, `CASPIO_CLIENT_SECRET`, `CASPIO_TABLE_ENDPOINT`, `CASPIO_SCOPE`
- **Processing:** `WORKER_CONCURRENCY`, `REQUEST_TIMEOUT_MS`

> **Sandbox defaults:** ALIS sandbox credentials provided in `.env.example` allow immediate integration testing; replace with tenant-specific values for production.

---

## Database Strategy

- **Development (default)** – SQLite via `prisma/schema.sqlite.prisma` (fast, file-based, no migrations). Use `prisma db push --schema=<sqlite schema>`.
- **Production/Staging** – PostgreSQL via `prisma/schema.prisma` (migration-ready). Initial schema is provided under `prisma/migrations/0001_init/`.
- **Per-company credentials** – `Credential` table stores BasicAuth usernames + bcrypt hashes (password storage left to future secret manager). Sandbox uses global credentials loaded from env.

---

## Webhook Flow

1. **Endpoint:** `POST /webhook/alis`
   - BasicAuth enforced (`WEBHOOK_BASIC_USER/PASS`)
   - IP allowlist (CIDR aware) optional
   - Payload validated via Zod (`CompanyKey`, `EventType`, `EventMessageId`, etc.)

2. **Idempotent event logging**
   - `EventLog` entry created per `EventMessageId`
   - Duplicates short-circuited (HTTP 200)
   - Unsupported/test events marked `ignored`

3. **Queue dispatch**
   - `process-alis-event` BullMQ job enqueued with event metadata
   - Default job options: 5 attempts, exponential backoff

4. **Worker processing**
   - Resolve company credentials (sandbox fallback)
   - Fetch resident detail/basicInfo (+ leave when relevant) via ALIS API
   - Normalize resident state → `Resident` table upsert
   - Build Caspio payload (ADT status, room/bed, leave info)
   - Obtain OAuth token + upsert to Caspio (retry 3x on 429/5xx)
   - Update `EventLog` status (`processed`/`failed`)

5. **Observability**
   - Pino structured logs (PII redacted)
   - `/health` + `/health/deps` endpoints (ALIS, DB, Redis checks)

---

## Worker & Queue

- Queue defined in `src/workers/queue.ts`
- Worker entrypoint `npm run worker` (`src/workers/index.ts`)
- Concurrency configurable via `WORKER_CONCURRENCY`
- Redis connection automatically swaps to `ioredis-mock` during Jest tests

---

## Testing ALIS Communities API

Test the ALIS Communities endpoint to verify API connectivity and explore available communities:

```bash
npm run test:communities
```

This script:
- Connects to ALIS API using sandbox credentials from `.env`
- Fetches all communities via `GET /v1/integration/communities`
- Displays community details (ID, name, company key, location, contact info)
- Logs structured output for debugging

The `AlisClient` now includes a `getCommunities()` method that returns properly typed `AlisCommunity[]` data.

---

## Backfill Residents

Command: 
```bash
npm run backfill -- --companyKey appstoresandbox [--communityId 123] [--pageSize 100] [--dryRun] [--skipCaspio]
```

Performs paginated `GET /v1/integration/residents`, hydrates each resident (detail/basicInfo), normalises, upserts DB, and forwards to Caspio (unless `--skipCaspio`). Provides safe `--dryRun` preview.

---

## Testing

```bash
npm test
```

- `tests/setupEnv.ts` seeds env vars for ALIS/Caspio/Auth
- Jest mocks Prisma queue dependencies for HTTP tests
- Supertest covers webhook behaviour (auth, validation, idempotency)
- Additional unit tests encouraged for mappers, Caspio retries, etc.

---

## Docker Usage

1. Build + run service:
   ```bash
   docker build -t alis-eyewatch .
   docker run -p 8080:8080 --env-file ./.env alis-eyewatch
   ```

2. Supporting infrastructure:
   ```bash
   docker-compose up -d
   # Postgres on 5432, Redis on 6379
   ```

---

## Deployment

For production deployment instructions, including database migration setup and platform-specific guides (Render, Railway, Heroku, AWS, GCP), see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

**Quick deployment commands:**
```bash
# Build and deploy with automatic migrations
npm run build
npm run deploy          # For HTTP server
npm run deploy:worker   # For BullMQ worker
```

---

## Operational Notes

- **Security:** Never log resident PII (names/DOB). BasicAuth credentials stored in env; per-company secrets should be injected via secure vaults.
- **Resilience:** BullMQ retries, Caspio exponential backoff, ALIS HTTP logging. EventLog status transitions: `received` → `queued` → `processed`/`failed`/`ignored`.
- **Monitoring:** Extend Pino logs to your SIEM; `/health/deps` ensures ALIS + DB + Redis connectivity.
- **Extensibility:** `integrations/mappers.ts` centralises resident/leave transformations; adjust mapping for new Caspio schema fields.

---

## Resources

- ALIS Sandbox UI: https://appstoresandbox.alisonline.com/
- Webhook allowed IPs (default): `40.122.155.32/30`
- Caspio REST docs: https://howto.caspio.com/web-services/rest-api/

Happy integrating! Reach out with issues or PRs to expand coverage and integration depth.
