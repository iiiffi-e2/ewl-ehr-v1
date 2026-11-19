# Unmatched Room CUID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a Yardi patient under the synthetic room `CUID` when Caspio has no real one, and keep one resolvable Postgres row per company, community, patient, and room.

**Architecture:** `UnmatchedCuid` is a Postgres worklist. HL7 and FHIR call `recordUnmatchedCuid` only after the Caspio writes for that event succeed, or after a deliberate skip that leaves a real `CUID` untouched. Staff list and resolve rows through `/admin/unmatched-cuids`. Resolve does not call Caspio.

**Tech Stack:** TypeScript, Prisma 5, Jest, Express, existing Caspio client and `resolveEffectiveCuid`.

**Spec:** `docs/superpowers/specs/2026-11-18-unmatched-cuid-design.md`

## Global Constraints

- Patient stays on the existing Caspio patient table. Synthetic id is `COMM-{communityId}-{room}`, or `COMM-{communityId}` when the trimmed room is empty.
- Service stays on the existing Caspio service table when the event already writes a service.
- Do not insert a Caspio community row for a synthetic `CUID`.
- One `UnmatchedCuid` row per `companyId`, `communityId`, `externalResidentId`, and trimmed `roomNumber` (empty string when the room is blank).
- A real room `CUID` does not insert, update, or close an `UnmatchedCuid` row.
- Resolve updates only Postgres. A later synthetic event reopens a resolved row.
- A later HL7 event that finds a real room `CUID` keeps the existing patient-number fallback. That fallback may write the real `CUID` onto a patient previously stored under the synthetic id, and an A02 may move the service. The `UnmatchedCuid` row stays open. A synthetic A02 for a patient who is not in Caspio records `patient_not_found` and does not open a worklist row.
- EyeWatch care-plan sync stays unchanged.
- Do not write `EventProcessingIssue.stage = missing_cuid` for this case.
- A thrown Caspio write does not insert the worklist row. A thrown worklist write does not fail the event.
- Shadow mode and FHIR `skipCaspio` do not open a row.
- A patient-number fallback must not copy a synthetic `CUID` onto a Caspio row that already has a different `CUID`, except HL7 A02.

---

## File structure

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | `UnmatchedCuid` model and `Company` relation |
| `prisma/schema.sqlite.prisma` | Same model for the sqlite schema |
| `prisma/migrations/20261119025000_add_unmatched_cuid/migration.sql` | Postgres table, unique key, indexes |
| `src/domains/unmatchedCuid.ts` | Record, list, and resolve. Swallows its own write errors |
| `src/integrations/caspio/yardiHl7EventOrchestrator.ts` | Synthetic HL7 `CUID` and the per-trigger guard |
| `src/integrations/yardi/yardiFhirSync.ts` | Record after a synthetic FHIR patient push |
| `src/http/routes.ts` | Admin list and resolve routes |
| `public/unmatched-cuids.html` | Open-row list and Resolve button |
| `src/admin/yardiHl7Test.ts` | Return `syntheticCuid`; stop inferring `missing_cuid` |
| `docs/yardi-community-setup.md` | Missing-room behavior points at the new page |
| Tests listed on each task | TDD |

---

### Task 1: Prisma model

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.sqlite.prisma`
- Create: `prisma/migrations/20261119025000_add_unmatched_cuid/migration.sql`

**Interfaces:**
- Consumes: existing `Company` model
- Produces: Prisma delegate `prisma.unmatchedCuid` with unique input `companyId_communityId_externalResidentId_roomNumber`

- [ ] **Step 1: Add the model to both schemas**

On `Company` in both schema files, add `unmatchedCuids UnmatchedCuid[]` next to `eventIssues`.

Add this model to both files:

```prisma
model UnmatchedCuid {
  id                 Int       @id @default(autoincrement())
  companyId          Int
  communityId        Int
  externalResidentId String
  roomNumber         String    @default("")
  source             String
  firstName          String?
  lastName           String?
  dateOfBirth        DateTime?
  syntheticCuid      String
  status             String    @default("open")
  firstSeenAt        DateTime  @default(now())
  lastSeenAt         DateTime  @default(now())
  lastEventType      String
  lastEventMessageId String
  resolvedAt         DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  company Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, communityId, externalResidentId, roomNumber])
  @@index([communityId, status])
  @@index([status, lastSeenAt])
}
```

- [ ] **Step 2: Add the migration**

Create `prisma/migrations/20261119025000_add_unmatched_cuid/migration.sql`:

```sql
CREATE TABLE "UnmatchedCuid" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "communityId" INTEGER NOT NULL,
    "externalResidentId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "syntheticCuid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventType" TEXT NOT NULL,
    "lastEventMessageId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmatchedCuid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnmatchedCuid_companyId_communityId_externalResidentId_roomNumber_key"
ON "UnmatchedCuid"("companyId", "communityId", "externalResidentId", "roomNumber");

CREATE INDEX "UnmatchedCuid_communityId_status_idx"
ON "UnmatchedCuid"("communityId", "status");

CREATE INDEX "UnmatchedCuid_status_lastSeenAt_idx"
ON "UnmatchedCuid"("status", "lastSeenAt");

ALTER TABLE "UnmatchedCuid"
ADD CONSTRAINT "UnmatchedCuid_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate the client**

Run: `npx prisma generate`

Expected: generation finishes and `PrismaClient` includes `unmatchedCuid`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/schema.sqlite.prisma prisma/migrations/20261119025000_add_unmatched_cuid/migration.sql
git commit -m "feat: add UnmatchedCuid worklist table"
```

---

### Task 2: Worklist domain

**Files:**
- Create: `src/domains/unmatchedCuid.ts`
- Create: `tests/domains/unmatchedCuid.test.ts`
- Test: `tests/domains/unmatchedCuid.test.ts`

**Interfaces:**
- Consumes: `prisma.unmatchedCuid`, `recordEventIssue` from `src/domains/eventIssues.ts`
- Produces:

```ts
export class UnmatchedCuidQueryError extends Error {
  readonly statusCode = 400;
}

export type RecordUnmatchedCuidInput = {
  companyId: number;
  communityId: number;
  externalResidentId: string;
  roomNumber?: string | null;
  source: 'yardi-hl7' | 'yardi-fhir';
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  syntheticCuid: string;
  eventType: string;
  eventMessageId: string;
};

export type UnmatchedCuidListStatus = 'open' | 'resolved' | 'all';

export async function recordUnmatchedCuid(input: RecordUnmatchedCuidInput): Promise<void>;
export async function listUnmatchedCuids(query: {
  status?: UnmatchedCuidListStatus;
  communityId?: number;
}): Promise<UnmatchedCuidRow[]>;
export async function resolveUnmatchedCuid(id: number): Promise<UnmatchedCuidRow | null>;
```

`UnmatchedCuidRow` is the Prisma model type. `listUnmatchedCuids` throws `UnmatchedCuidQueryError` when `status` is anything else. `resolveUnmatchedCuid` returns `null` when the id is missing, and returns the existing row when it is already `resolved`.

- [ ] **Step 1: Write the failing tests**

Create `tests/domains/unmatchedCuid.test.ts`:

```ts
const findUniqueMock = jest.fn();
const createMock = jest.fn();
const updateMock = jest.fn();
const findManyMock = jest.fn();
const recordEventIssueMock = jest.fn();

jest.mock('../../src/db/prisma.js', () => ({
  prisma: {
    unmatchedCuid: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

jest.mock('../../src/domains/eventIssues.js', () => ({
  recordEventIssue: (...args: unknown[]) => recordEventIssueMock(...args),
  errorToIssueDetails: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import {
  listUnmatchedCuids,
  recordUnmatchedCuid,
  resolveUnmatchedCuid,
  UnmatchedCuidQueryError,
} from '../../src/domains/unmatchedCuid.js';

const input = {
  companyId: 10,
  communityId: 113,
  externalResidentId: '418612',
  roomNumber: ' 141 ',
  source: 'yardi-hl7' as const,
  firstName: 'Denise',
  lastName: 'Morgan',
  dateOfBirth: '2022-09-01T00:00:00.000Z',
  syntheticCuid: 'COMM-113-141',
  eventType: 'hl7.adt.a01',
  eventMessageId: 'yardi-hl7-event-1',
};

describe('recordUnmatchedCuid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 1 });
    updateMock.mockResolvedValue({ id: 1 });
  });

  it('inserts one open row with a trimmed room', async () => {
    await recordUnmatchedCuid(input);

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 10,
        communityId: 113,
        externalResidentId: '418612',
        roomNumber: '141',
        source: 'yardi-hl7',
        firstName: 'Denise',
        lastName: 'Morgan',
        syntheticCuid: 'COMM-113-141',
        status: 'open',
        lastEventType: 'hl7.adt.a01',
        lastEventMessageId: 'yardi-hl7-event-1',
        resolvedAt: null,
      }),
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('updates the same key and reopens a resolved row without changing firstSeenAt', async () => {
    findUniqueMock.mockResolvedValue({
      id: 7,
      status: 'resolved',
      firstName: 'Denise',
      lastName: 'Morgan',
    });

    await recordUnmatchedCuid({
      ...input,
      firstName: ' ',
      eventMessageId: 'yardi-hl7-event-2',
    });

    expect(createMock).not.toHaveBeenCalled();
    const data = updateMock.mock.calls[0][0].data;
    expect(data.status).toBe('open');
    expect(data.resolvedAt).toBeNull();
    expect(data.lastEventMessageId).toBe('yardi-hl7-event-2');
    expect(data.firstSeenAt).toBeUndefined();
    expect(data.firstName).toBeUndefined();
  });

  it('stores an empty room string when the room is blank', async () => {
    await recordUnmatchedCuid({ ...input, roomNumber: '   ' });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ roomNumber: '' }),
    });
  });

  it('records an issue and skips prisma when the patient number is blank', async () => {
    await recordUnmatchedCuid({ ...input, externalResidentId: '  ' });

    expect(createMock).not.toHaveBeenCalled();
    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'unmatched_cuid_record_failed',
        companyId: 10,
        source: 'yardi-hl7',
        eventMessageId: 'yardi-hl7-event-1',
      }),
    );
  });

  it('swallows a prisma error and records unmatched_cuid_record_failed', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));

    await expect(recordUnmatchedCuid(input)).resolves.toBeUndefined();

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'unmatched_cuid_record_failed' }),
    );
  });
});

describe('listUnmatchedCuids', () => {
  it('defaults to open rows ordered by lastSeenAt desc', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await listUnmatchedCuids({});
    expect(findManyMock).toHaveBeenCalledWith({
      where: { status: 'open' },
      orderBy: { lastSeenAt: 'desc' },
    });
  });

  it('filters by community and status', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await listUnmatchedCuids({ status: 'all', communityId: 113 });
    expect(findManyMock).toHaveBeenCalledWith({
      where: { communityId: 113 },
      orderBy: { lastSeenAt: 'desc' },
    });
  });

  it('rejects an unknown status', async () => {
    await expect(
      listUnmatchedCuids({ status: 'nope' as 'open' }),
    ).rejects.toBeInstanceOf(UnmatchedCuidQueryError);
  });
});

describe('resolveUnmatchedCuid', () => {
  it('returns null when the id is missing', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(resolveUnmatchedCuid(4)).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns a resolved row unchanged', async () => {
    const row = { id: 4, status: 'resolved', resolvedAt: new Date('2026-11-18T00:00:00.000Z') };
    findUniqueMock.mockResolvedValueOnce(row);
    await expect(resolveUnmatchedCuid(4)).resolves.toBe(row);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('sets status and resolvedAt', async () => {
    findUniqueMock.mockResolvedValueOnce({ id: 4, status: 'open' });
    updateMock.mockResolvedValueOnce({ id: 4, status: 'resolved' });
    await resolveUnmatchedCuid(4);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { status: 'resolved', resolvedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest tests/domains/unmatchedCuid.test.ts --runInBand`

Expected: FAIL because `src/domains/unmatchedCuid.ts` does not exist.

- [ ] **Step 3: Implement the domain module**

Create `src/domains/unmatchedCuid.ts`:

```ts
import type { UnmatchedCuid } from '@prisma/client';

import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { errorToIssueDetails, recordEventIssue } from './eventIssues.js';

export class UnmatchedCuidQueryError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UnmatchedCuidQueryError';
  }
}

export type RecordUnmatchedCuidInput = {
  companyId: number;
  communityId: number;
  externalResidentId: string;
  roomNumber?: string | null;
  source: 'yardi-hl7' | 'yardi-fhir';
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  syntheticCuid: string;
  eventType: string;
  eventMessageId: string;
};

export type UnmatchedCuidListStatus = 'open' | 'resolved' | 'all';
export type UnmatchedCuidRow = UnmatchedCuid;

const uniqueKey = (input: {
  companyId: number;
  communityId: number;
  externalResidentId: string;
  roomNumber: string;
}) => ({
  companyId_communityId_externalResidentId_roomNumber: {
    companyId: input.companyId,
    communityId: input.communityId,
    externalResidentId: input.externalResidentId,
    roomNumber: input.roomNumber,
  },
});

function providedText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseDateOfBirth(value?: string | null): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function recordUnmatchedCuid(input: RecordUnmatchedCuidInput): Promise<void> {
  const externalResidentId = input.externalResidentId.trim();
  if (!externalResidentId) {
    await recordEventIssue({
      companyId: input.companyId,
      source: input.source,
      eventType: input.eventType,
      eventMessageId: input.eventMessageId,
      communityId: input.communityId,
      stage: 'unmatched_cuid_record_failed',
      severity: 'error',
      message: 'Unmatched CUID row skipped because the patient number is blank',
      retryable: false,
    });
    return;
  }

  const roomNumber = input.roomNumber?.trim() ?? '';
  const firstName = providedText(input.firstName);
  const lastName = providedText(input.lastName);
  const dateOfBirth = parseDateOfBirth(input.dateOfBirth);
  const key = {
    companyId: input.companyId,
    communityId: input.communityId,
    externalResidentId,
    roomNumber,
  };

  try {
    const existing = await prisma.unmatchedCuid.findUnique({ where: uniqueKey(key) });
    const refresh: {
      source: string;
      syntheticCuid: string;
      lastSeenAt: Date;
      lastEventType: string;
      lastEventMessageId: string;
      status: string;
      resolvedAt: null;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: Date;
    } = {
      source: input.source,
      syntheticCuid: input.syntheticCuid,
      lastSeenAt: new Date(),
      lastEventType: input.eventType,
      lastEventMessageId: input.eventMessageId,
      status: 'open',
      resolvedAt: null,
    };
    if (firstName) refresh.firstName = firstName;
    if (lastName) refresh.lastName = lastName;
    if (dateOfBirth) refresh.dateOfBirth = dateOfBirth;

    if (!existing) {
      await prisma.unmatchedCuid.create({
        data: {
          ...key,
          ...refresh,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          dateOfBirth,
          firstSeenAt: new Date(),
        },
      });
      return;
    }

    await prisma.unmatchedCuid.update({ where: { id: existing.id }, data: refresh });
  } catch (error) {
    logger.error(
      {
        companyId: input.companyId,
        communityId: input.communityId,
        externalResidentId,
        eventMessageId: input.eventMessageId,
        error: error instanceof Error ? error.message : String(error),
      },
      'unmatched_cuid_record_failed',
    );
    await recordEventIssue({
      companyId: input.companyId,
      source: input.source,
      eventType: input.eventType,
      eventMessageId: input.eventMessageId,
      communityId: input.communityId,
      stage: 'unmatched_cuid_record_failed',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      details: errorToIssueDetails(error),
      retryable: false,
    });
  }
}

export async function listUnmatchedCuids(query: {
  status?: UnmatchedCuidListStatus;
  communityId?: number;
}): Promise<UnmatchedCuidRow[]> {
  const status = query.status ?? 'open';
  if (status !== 'open' && status !== 'resolved' && status !== 'all') {
    throw new UnmatchedCuidQueryError('status must be open, resolved, or all');
  }

  return prisma.unmatchedCuid.findMany({
    where: {
      ...(status === 'all' ? {} : { status }),
      ...(query.communityId === undefined ? {} : { communityId: query.communityId }),
    },
    orderBy: { lastSeenAt: 'desc' },
  });
}

export async function resolveUnmatchedCuid(id: number): Promise<UnmatchedCuidRow | null> {
  const row = await prisma.unmatchedCuid.findUnique({ where: { id } });
  if (!row) return null;
  if (row.status === 'resolved') return row;
  return prisma.unmatchedCuid.update({
    where: { id },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest tests/domains/unmatchedCuid.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/unmatchedCuid.ts tests/domains/unmatchedCuid.test.ts
git commit -m "feat: record and resolve unmatched room CUID rows"
```

---

### Task 3: HL7 synthetic CUID

**Files:**
- Modify: `src/integrations/caspio/yardiHl7EventOrchestrator.ts`
- Modify: `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts`
- Test: `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts`

**Interfaces:**
- Consumes: `recordUnmatchedCuid(RecordUnmatchedCuidInput)`, `resolveEffectiveCuid(enrichment, communityId, roomNumber)`
- Produces: `handleYardiHl7Event` writes `COMM-{communityId}-{room}` and calls `recordUnmatchedCuid` under the trigger rules in the spec

- [ ] **Step 1: Replace the missing-CUID tests**

In `tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts`, add the mock next to the other mocks:

```ts
const recordUnmatchedCuidMock = jest.fn();

jest.mock('../../../src/domains/unmatchedCuid.js', () => ({
  recordUnmatchedCuid: (...args: unknown[]) => recordUnmatchedCuidMock(...args),
}));
```

In `beforeEach`, add `recordUnmatchedCuidMock.mockResolvedValue(undefined);`.

Replace the test named `records missing_cuid and skips patient writes when room enrichment has no CUID` with:

```ts
it('writes an A01 under the synthetic CUID and records one unmatched row', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({ CommunityName: 'EyeWatch Live' });

  await handleYardiHl7Event(baseInput());

  expect(upsertByFieldsMock).toHaveBeenCalledWith(
    'CarePatientTable_API',
    [
      { field: 'PatientNumber', value: '418612' },
      { field: 'CUID', value: 'COMM-113-141' },
    ],
    expect.objectContaining({ CUID: 'COMM-113-141', RoomNumber: '141' }),
  );
  expect(upsertByFieldsMock).toHaveBeenCalledWith(
    'Service_Table_API',
    expect.arrayContaining([{ field: 'CUID', value: 'COMM-113-141' }]),
    expect.objectContaining({ CUID: 'COMM-113-141' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalledWith(
    expect.objectContaining({
      companyId: 10,
      communityId: 113,
      externalResidentId: '418612',
      roomNumber: '141',
      source: 'yardi-hl7',
      syntheticCuid: 'COMM-113-141',
      eventType: 'hl7.adt.a01',
      eventMessageId: 'yardi-hl7-event-1',
    }),
  );
  expect(recordUnmatchedCuidMock.mock.invocationCallOrder[0]).toBeGreaterThan(
    upsertByFieldsMock.mock.invocationCallOrder[0],
  );
  expect(recordEventIssueMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'missing_cuid' }),
  );
});

it('does not record an unmatched row when A01 has a real CUID', async () => {
  await handleYardiHl7Event(baseInput());
  expect(recordUnmatchedCuidMock).not.toHaveBeenCalled();
});

it('does not record an unmatched row when the A01 patient write throws', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  upsertByFieldsMock.mockRejectedValueOnce(new Error('caspio down'));

  await expect(handleYardiHl7Event(baseInput())).rejects.toThrow('caspio down');
  expect(recordUnmatchedCuidMock).not.toHaveBeenCalled();
});
```

Replace the test named `requires an enriched CUID before update workflow writes` with these tests. Each one uses `getCommunityEnrichmentMock.mockResolvedValueOnce({})` unless noted.

```ts
it('inserts A05 on the synthetic key and leaves a different CUID row alone', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-real',
    raw: { PatientNumber: '418612', CUID: 'room-cuid' },
  });

  await handleYardiHl7Event(baseInput('hl7.adt.a05', { trigger: 'A05' }));

  expect(updateRecordByIdMock).not.toHaveBeenCalled();
  expect(upsertByFieldsMock).toHaveBeenCalledWith(
    'CarePatientTable_API',
    expect.arrayContaining([{ field: 'CUID', value: 'COMM-113-141' }]),
    expect.objectContaining({ CUID: 'COMM-113-141' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});

it('moves an A02 patient onto the synthetic destination CUID', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-1',
    raw: { PatientNumber: '418612', CUID: 'room-cuid', RoomNumber: '100' },
  });
  findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
    found: true,
    id: 'svc-1',
    record: { CUID: 'room-cuid' },
  });

  await handleYardiHl7Event(baseInput('hl7.adt.a02', { trigger: 'A02' }));

  expect(updateRecordByIdMock).toHaveBeenCalledWith(
    'CarePatientTable_API',
    'patient-1',
    expect.objectContaining({ CUID: 'COMM-113-141', RoomNumber: '141' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalledWith(
    expect.objectContaining({ syntheticCuid: 'COMM-113-141', source: 'yardi-hl7' }),
  );
});

it('leaves an A08 real CUID row unchanged and still records the unmatched row', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-1',
    raw: { CUID: 'room-cuid' },
  });

  await handleYardiHl7Event(baseInput('hl7.adt.a08', { trigger: 'A08' }));

  expect(updateRecordByIdMock).not.toHaveBeenCalled();
  expect(upsertByFieldsMock).not.toHaveBeenCalled();
  expect(recordEventIssueMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'patient_not_found' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});

it('records patient_not_found and the unmatched row when A08 has no Caspio patient', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({ found: false });

  await handleYardiHl7Event(baseInput('hl7.adt.a08', { trigger: 'A08' }));

  expect(recordEventIssueMock).toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'patient_not_found' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});

it('updates A03 only when the patient is already on the synthetic CUID', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-1',
    record: { CUID: 'COMM-113-141' },
  });
  findActiveOrLatestServiceRowMock.mockResolvedValueOnce({ found: false });

  await handleYardiHl7Event(baseInput('hl7.adt.a03', { trigger: 'A03' }));

  expect(updateRecordByIdMock).toHaveBeenCalledWith(
    'CarePatientTable_API',
    'patient-1',
    expect.objectContaining({ On_Prem: false }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});

it('does not move-out a patient who only exists under a different CUID', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-1',
    raw: { CUID: 'room-cuid' },
  });

  await handleYardiHl7Event(baseInput('hl7.adt.a03', { trigger: 'A03' }));

  expect(updateRecordByIdMock).not.toHaveBeenCalled();
  expect(recordEventIssueMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'patient_not_found' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});

it('records patient_not_found for A21 when no patient exists', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({ found: false });

  await handleYardiHl7Event(baseInput('hl7.adt.a21', { trigger: 'A21' }));

  expect(recordEventIssueMock).toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'patient_not_found' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
  expect(updateRecordByIdMock).not.toHaveBeenCalled();
});
```

```ts
it('does not end leave for a patient who only exists under a different CUID', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-1',
    raw: { CUID: 'room-cuid' },
  });

  await handleYardiHl7Event(baseInput('hl7.adt.a22', { trigger: 'A22' }));

  expect(updateRecordByIdMock).not.toHaveBeenCalled();
  expect(recordEventIssueMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'patient_not_found' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});

it('leaves an A60 real CUID row unchanged and still records the unmatched row', async () => {
  getCommunityEnrichmentMock.mockResolvedValueOnce({});
  findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
  findByPatientNumberMock.mockResolvedValueOnce({
    found: true,
    id: 'patient-1',
    raw: { CUID: 'room-cuid' },
  });

  await handleYardiHl7Event(baseInput('hl7.adt.a60', { trigger: 'A60' }));

  expect(updateRecordByIdMock).not.toHaveBeenCalled();
  expect(upsertByFieldsMock).not.toHaveBeenCalled();
  expect(recordEventIssueMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'patient_not_found' }),
  );
  expect(recordUnmatchedCuidMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts --runInBand`

Expected: FAIL. The new A01 test fails because no patient upsert uses `COMM-113-141` and `recordUnmatchedCuid` is not called.

- [ ] **Step 3: Implement the orchestrator changes**

Add `resolveEffectiveCuid` to the existing import from `../yardi/yardiFhirSync.js`.

Add:

```ts
import { recordUnmatchedCuid } from '../../domains/unmatchedCuid.js';
```

Add this type and these helpers next to `recordYardiIssue`:

```ts
type RoomEnrichment = {
  CUID: string;
  synthetic: boolean;
  CommunityName?: string;
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  roomNumber?: string;
};

async function rememberUnmatched(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  enrichment: RoomEnrichment,
): Promise<void> {
  if (!enrichment.synthetic) return;
  const demographics = input.residentBundle!.demographics;
  await recordUnmatchedCuid({
    companyId: input.companyId,
    communityId,
    externalResidentId: String(demographics.externalResidentId ?? ''),
    roomNumber: enrichment.roomNumber,
    source: 'yardi-hl7',
    firstName: demographics.firstName,
    lastName: demographics.lastName,
    dateOfBirth: demographics.dateOfBirth,
    syntheticCuid: enrichment.CUID,
    eventType: input.event.eventType,
    eventMessageId: input.event.eventMessageId,
  });
}

async function findPatientOnCuid(patientNumber: string, cuid: string) {
  return findRecordByFields(env.CASPIO_TABLE_NAME, [
    { field: 'PatientNumber', value: patientNumber },
    { field: 'CUID', value: cuid },
  ]);
}
```

Replace `getRequiredEnrichment` so it always returns `RoomEnrichment`. Delete the `missing_cuid` issue from that function and from `handleYardiMoveIn`. Use the helper for both:

```ts
async function getRoomEnrichment(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
): Promise<RoomEnrichment> {
  const bundle = input.residentBundle!;
  const roomNumber =
    bundle.demographics.roomNumber ??
    notificationString(input.event.notificationData, ['RoomNumber']);
  const vendorPayload = bundle.vendorPayload as YardiHl7VendorPayload | undefined;
  const fhirBundle = vendorPayload?.fhirBundle;
  const communityName = fhirBundle ? extractYardiCommunityName(fhirBundle) : undefined;
  const enrichment = await getCommunityEnrichment(communityId, roomNumber, communityName);
  const realCuid = enrichment.CUID?.trim();
  return {
    CUID: realCuid || resolveEffectiveCuid({}, communityId, roomNumber),
    synthetic: !realCuid,
    CommunityName: enrichment.CommunityName ?? communityName,
    Address: enrichment.Address,
    City: enrichment.City,
    State: enrichment.State,
    Zip: enrichment.Zip,
    roomNumber: roomNumber ?? undefined,
  };
}
```

In `handleYardiMoveIn`, replace the local enrichment lookup and the `if (!cuid) { record missing_cuid; return; }` block with `const enrichment = await getRoomEnrichment(input, communityId);` and use `enrichment.CUID` everywhere that function used `cuid`. After both `upsertByFields` calls succeed, call `await rememberUnmatched(input, communityId, enrichment);`.

In `handleYardiUpdate`, replace `getRequiredEnrichment` and the `if (!enrichment) return;` line with `getRoomEnrichment`. Then choose the patient lookup:

```ts
const restrictToSynthetic = enrichment.synthetic && !options.isTransfer;
const existing = restrictToSynthetic
  ? await findPatientOnCuid(patientNumber, enrichment.CUID)
  : await findExistingPatient(patientNumber, enrichment.CUID);

if (!existing.found || !existing.id) {
  if (restrictToSynthetic && !options.insertIfMissing) {
    const anyPatient = await findByPatientNumber(env.CASPIO_TABLE_NAME, patientNumber);
    if (!anyPatient.found) {
      await recordYardiIssue(
        input,
        'patient_not_found',
        `${trigger} event skipped because resident was not found in Caspio`,
        communityId,
      );
    }
    await rememberUnmatched(input, communityId, enrichment);
    return;
  }
  if (!options.insertIfMissing) {
    await recordYardiIssue(
      input,
      'patient_not_found',
      `${trigger} event skipped because resident was not found in Caspio`,
      communityId,
    );
    return;
  }
  // existing insert branch stays, using enrichment.CUID
  await rememberUnmatched(input, communityId, enrichment);
  return;
}
```

Keep the existing transfer and `updateRecordById` body. After that body finishes without throwing, call `await rememberUnmatched(input, communityId, enrichment);`.

Add this helper and use it at the start of `handleYardiMoveOut`, `handleYardiLeaveStart`, and `handleYardiLeaveEnd` in place of `getRequiredEnrichment` plus `requireExistingPatient`:

```ts
async function requirePatientForRoomEvent(
  input: CanonicalEventOrchestrationInput,
  communityId: number,
  enrichment: RoomEnrichment,
  missingMessage: string,
): Promise<
  { patientNumber: string; existing: { id: string; record?: Record<string, unknown> } } | undefined
> {
  const patientNumber = String(input.residentBundle!.demographics.externalResidentId);
  if (!enrichment.synthetic) {
    return requireExistingPatient(input, communityId, enrichment.CUID, missingMessage);
  }

  const onSynthetic = await findPatientOnCuid(patientNumber, enrichment.CUID);
  if (onSynthetic.found && onSynthetic.id) {
    return {
      patientNumber,
      existing: {
        id: onSynthetic.id,
        record: onSynthetic.record as Record<string, unknown> | undefined,
      },
    };
  }

  const anyPatient = await findByPatientNumber(env.CASPIO_TABLE_NAME, patientNumber);
  if (!anyPatient.found) {
    await recordYardiIssue(input, 'patient_not_found', missingMessage, communityId);
  }
  await rememberUnmatched(input, communityId, enrichment);
  return undefined;
}
```

Each of those three handlers:

```ts
const enrichment = await getRoomEnrichment(input, communityId);
const patient = await requirePatientForRoomEvent(input, communityId, enrichment, '<existing missing message>');
if (!patient) return;
```

After that handler's Caspio updates finish, call `await rememberUnmatched(input, communityId, enrichment);`. Do not call it before those updates. `findPatientOnCuid` returns `{ found, id, record }`. Map `found` from the Caspio client's result the same way `findExistingPatient` does (`match.found`).

- [ ] **Step 4: Run the orchestrator tests**

Run: `npx jest tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts --runInBand`

Expected: PASS, including the existing real-CUID A01, A02, A03, A21, and A22 tests.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/caspio/yardiHl7EventOrchestrator.ts tests/integrations/caspio/yardiHl7EventOrchestrator.test.ts
git commit -m "feat: write HL7 patients under a synthetic CUID and track them"
```

---

### Task 4: FHIR synthetic push

**Files:**
- Modify: `src/integrations/yardi/yardiFhirSync.ts`
- Create: `tests/integrations/yardi/yardiFhirCaspioPush.test.ts`
- Test: `tests/integrations/yardi/yardiFhirCaspioPush.test.ts`

**Interfaces:**
- Consumes: `recordUnmatchedCuid`, `isSyntheticCommunityCuid`
- Produces: optional second argument on `pushYardiFhirCaspioRecords`

```ts
export type YardiFhirUnmatchedContext = {
  companyId: number;
  externalResidentId: string;
  roomNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  eventType: string;
  eventMessageId: string;
};

export async function pushYardiFhirCaspioRecords(
  records: { tables: ...; patientRecord: ...; communityRecord: ...; serviceRecord?: ...; skipService?: boolean },
  unmatched?: YardiFhirUnmatchedContext,
): Promise<void>;
```

- [ ] **Step 1: Write the failing push tests**

Create `tests/integrations/yardi/yardiFhirCaspioPush.test.ts`:

```ts
const upsertByFieldsMock = jest.fn();
const upsertPatientByPatientNumberMock = jest.fn();
const recordUnmatchedCuidMock = jest.fn();

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
  },
}));

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  caspioRequestWithRetry: (operation: () => Promise<unknown>) => operation(),
  upsertByFields: (...args: unknown[]) => upsertByFieldsMock(...args),
  upsertPatientByPatientNumber: (...args: unknown[]) => upsertPatientByPatientNumberMock(...args),
}));

jest.mock('../../../src/domains/unmatchedCuid.js', () => ({
  recordUnmatchedCuid: (...args: unknown[]) => recordUnmatchedCuidMock(...args),
}));

import { pushYardiFhirCaspioRecords } from '../../../src/integrations/yardi/yardiFhirSync.js';

const context = {
  companyId: 10,
  externalResidentId: '418612',
  roomNumber: '141',
  firstName: 'Denise',
  lastName: 'Morgan',
  dateOfBirth: '2022-09-01T00:00:00.000Z',
  eventType: 'yardi.poll.sync',
  eventMessageId: 'yardi-poll-yourlife-113-p1',
};

function records(cuid: string) {
  return {
    tables: {
      patient: 'CarePatientTable_API',
      community: 'CommunityTable_API',
      service: 'Service_Table_API',
    },
    patientRecord: { PatientNumber: '418612', CUID: cuid, RoomNumber: '141' },
    communityRecord: { CommunityID: '113', CUID: cuid, RoomNumber: '141' },
    serviceRecord: { CUID: cuid, PatientNumber: '418612', ServiceType: 'Unassigned' },
    skipService: true,
  };
}

describe('pushYardiFhirCaspioRecords unmatched CUID', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upsertPatientByPatientNumberMock.mockResolvedValue({});
    upsertByFieldsMock.mockResolvedValue({});
    recordUnmatchedCuidMock.mockResolvedValue(undefined);
  });

  it('records the worklist after a synthetic patient write and skips the community insert', async () => {
    await pushYardiFhirCaspioRecords(records('COMM-113-141'), context);

    expect(upsertByFieldsMock).not.toHaveBeenCalled();
    expect(upsertPatientByPatientNumberMock).toHaveBeenCalled();
    expect(recordUnmatchedCuidMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 10,
        communityId: 113,
        source: 'yardi-fhir',
        syntheticCuid: 'COMM-113-141',
        eventType: 'yardi.poll.sync',
        eventMessageId: 'yardi-poll-yourlife-113-p1',
      }),
    );
    expect(recordUnmatchedCuidMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      upsertPatientByPatientNumberMock.mock.invocationCallOrder[0],
    );
  });

  it('does not record a row for a real CUID', async () => {
    await pushYardiFhirCaspioRecords(records('965'), context);
    expect(recordUnmatchedCuidMock).not.toHaveBeenCalled();
  });

  it('does not record a row when the patient write throws', async () => {
    upsertPatientByPatientNumberMock.mockRejectedValueOnce(new Error('caspio down'));
    await expect(pushYardiFhirCaspioRecords(records('COMM-113-141'), context)).rejects.toThrow(
      'caspio down',
    );
    expect(recordUnmatchedCuidMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest tests/integrations/yardi/yardiFhirCaspioPush.test.ts --runInBand`

Expected: FAIL because the second argument is ignored and `recordUnmatchedCuid` is not called.

- [ ] **Step 3: Record after the patient write**

In `src/integrations/yardi/yardiFhirSync.ts`, import `recordUnmatchedCuid` from `../../domains/unmatchedCuid.js`.

Export `YardiFhirUnmatchedContext` with the fields in the Interfaces block. Add it as the optional second parameter of `pushYardiFhirCaspioRecords`.

Add this function in that file:

```ts
async function recordSyntheticFhirCuid(
  records: {
    patientRecord: Record<string, unknown>;
    communityRecord: Record<string, unknown>;
  },
  unmatched?: YardiFhirUnmatchedContext,
): Promise<void> {
  if (!unmatched) return;
  const communityId = Number(records.communityRecord.CommunityID ?? NaN);
  const roomNumber =
    typeof records.communityRecord.RoomNumber === 'string'
      ? records.communityRecord.RoomNumber
      : undefined;
  const cuid = records.patientRecord.CUID ? String(records.patientRecord.CUID) : '';
  if (!Number.isFinite(communityId) || !isSyntheticCommunityCuid(cuid, communityId, roomNumber)) {
    return;
  }
  await recordUnmatchedCuid({
    ...unmatched,
    communityId,
    source: 'yardi-fhir',
    syntheticCuid: cuid,
    roomNumber: roomNumber ?? unmatched.roomNumber,
  });
}
```

Call `await recordSyntheticFhirCuid(records, unmatched)` only after the patient upsert. When the function returns early because the service is skipped or missing, call it immediately before that return. When a service row is written, call it after that service upsert returns. Do not call it before the patient upsert.

Add this helper:

```ts
function unmatchedContextFromBundle(bundle: CanonicalResidentBundle): YardiFhirUnmatchedContext {
  return {
    companyId: bundle.companyId,
    externalResidentId: bundle.demographics.externalResidentId,
    roomNumber: bundle.demographics.roomNumber,
    firstName: bundle.demographics.firstName,
    lastName: bundle.demographics.lastName,
    dateOfBirth: bundle.demographics.dateOfBirth,
    eventType: bundle.event.eventType,
    eventMessageId: bundle.event.eventMessageId,
  };
}
```

Pass `unmatchedContextFromBundle(residentBundle)` as the second argument at both push call sites in `runYardiFhirSyncForTarget`: the direct `pushYardiFhirCaspioRecords` call and `pushYardiFhirBundleToCaspio`. `pushYardiFhirBundleToCaspio` forwards that context into `pushYardiFhirCaspioRecords`.

- [ ] **Step 4: Run the push tests**

Run: `npx jest tests/integrations/yardi/yardiFhirCaspioPush.test.ts tests/integrations/yardi/yardiFhirSync.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiFhirSync.ts tests/integrations/yardi/yardiFhirCaspioPush.test.ts
git commit -m "feat: track FHIR patients written under a synthetic CUID"
```

---

### Task 5: Admin list and resolve

**Files:**
- Modify: `src/http/routes.ts`
- Create: `public/unmatched-cuids.html`
- Create: `tests/http/unmatchedCuid.routes.test.ts`
- Test: `tests/http/unmatchedCuid.routes.test.ts`

**Interfaces:**
- Consumes: `listUnmatchedCuids`, `resolveUnmatchedCuid`, `UnmatchedCuidQueryError`
- Produces:
  - `GET /admin/unmatched-cuids` redirects to `/public/unmatched-cuids.html`
  - `GET /admin/unmatched-cuids/rows?status=&communityId=` returns `{ success: true, rows }`
  - `POST /admin/unmatched-cuids/:id/resolve` returns `{ success: true, row }`
  - Unknown status or a non-numeric `communityId` returns 400 `{ success: false, error }`
  - Unknown id returns 404 `{ success: false, error: 'Unmatched CUID row not found' }`

The page route and the JSON route are separate so the redirect does not swallow the list query.

- [ ] **Step 1: Write the failing route tests**

Create `tests/http/unmatchedCuid.routes.test.ts`:

```ts
import request from 'supertest';

const listUnmatchedCuidsMock = jest.fn();
const resolveUnmatchedCuidMock = jest.fn();

jest.mock('../../src/domains/unmatchedCuid.js', () => {
  class UnmatchedCuidQueryError extends Error {
    statusCode = 400;
  }
  return {
    UnmatchedCuidQueryError,
    listUnmatchedCuids: (...args: unknown[]) => listUnmatchedCuidsMock(...args),
    resolveUnmatchedCuid: (...args: unknown[]) => resolveUnmatchedCuidMock(...args),
  };
});

import { UnmatchedCuidQueryError } from '../../src/domains/unmatchedCuid.js';
import { createApp } from '../../src/http/app.js';

const app = createApp();
const authHeader = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;

describe('unmatched CUID admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires admin auth', async () => {
    const response = await request(app).get('/admin/unmatched-cuids/rows');
    expect(response.status).toBe(401);
  });

  it('redirects the page route', async () => {
    const response = await request(app)
      .get('/admin/unmatched-cuids')
      .set('Authorization', authHeader);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/public/unmatched-cuids.html');
  });

  it('lists open rows', async () => {
    listUnmatchedCuidsMock.mockResolvedValueOnce([{ id: 1, status: 'open' }]);
    const response = await request(app)
      .get('/admin/unmatched-cuids/rows?communityId=113')
      .set('Authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body.rows).toEqual([{ id: 1, status: 'open' }]);
    expect(listUnmatchedCuidsMock).toHaveBeenCalledWith({
      status: 'open',
      communityId: 113,
    });
  });

  it('returns 400 for an unknown status', async () => {
    listUnmatchedCuidsMock.mockRejectedValueOnce(
      new UnmatchedCuidQueryError('status must be open, resolved, or all'),
    );
    const response = await request(app)
      .get('/admin/unmatched-cuids/rows?status=nope')
      .set('Authorization', authHeader);
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('resolves a row', async () => {
    resolveUnmatchedCuidMock.mockResolvedValueOnce({ id: 4, status: 'resolved' });
    const response = await request(app)
      .post('/admin/unmatched-cuids/4/resolve')
      .set('Authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body.row.status).toBe('resolved');
    expect(resolveUnmatchedCuidMock).toHaveBeenCalledWith(4);
  });

  it('returns 404 when the row is missing', async () => {
    resolveUnmatchedCuidMock.mockResolvedValueOnce(null);
    const response = await request(app)
      .post('/admin/unmatched-cuids/4/resolve')
      .set('Authorization', authHeader);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Unmatched CUID row not found');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest tests/http/unmatchedCuid.routes.test.ts --runInBand`

Expected: FAIL with 404 on `GET /admin/unmatched-cuids/rows`.

- [ ] **Step 3: Add the routes and page**

In `src/http/routes.ts`, import `listUnmatchedCuids`, `resolveUnmatchedCuid`, and `UnmatchedCuidQueryError` from `../domains/unmatchedCuid.js`.

Add the page redirect next to the other admin page redirects:

```ts
router.get('/admin/unmatched-cuids', authAdmin, (_req, res) => {
  res.redirect('/public/unmatched-cuids.html');
});
```

Add the JSON routes:

```ts
router.get('/admin/unmatched-cuids/rows', authAdmin, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const communityRaw = req.query.communityId;
    let communityId: number | undefined;
    if (typeof communityRaw === 'string' && communityRaw.trim() !== '') {
      communityId = Number(communityRaw);
      if (!Number.isInteger(communityId)) {
        res.status(400).json({ success: false, error: 'communityId must be an integer' });
        return;
      }
    }
    const rows = await listUnmatchedCuids({
      status: (status as 'open' | 'resolved' | 'all' | undefined) ?? 'open',
      communityId,
    });
    res.json({ success: true, rows });
  } catch (error) {
    if (error instanceof UnmatchedCuidQueryError) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    throw error;
  }
});

router.post('/admin/unmatched-cuids/:id/resolve', authAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'id must be an integer' });
    return;
  }
  const row = await resolveUnmatchedCuid(id);
  if (!row) {
    res.status(404).json({ success: false, error: 'Unmatched CUID row not found' });
    return;
  }
  res.json({ success: true, row });
});
```

Create `public/unmatched-cuids.html` with this page:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unmatched CUIDs</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    header, .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 18px; padding: 16px; }
    h1 { color: #58a6ff; font-size: 24px; margin-bottom: 8px; }
    .muted { color: #8b949e; font-size: 13px; }
    label { display: block; margin-bottom: 6px; color: #8b949e; font-size: 12px; text-transform: uppercase; }
    input, select { padding: 9px 10px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; }
    button { background: #238636; color: white; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #30363d; font-size: 13px; }
    .error { color: #f85149; }
  </style>
</head>
<body>
  <header>
    <h1>Unmatched CUIDs</h1>
    <p class="muted">Patients written under a synthetic room CUID. Resolve updates this list only.</p>
  </header>
  <section class="card">
    <label for="status">Status</label>
    <select id="status">
      <option value="open" selected>open</option>
      <option value="resolved">resolved</option>
      <option value="all">all</option>
    </select>
    <label for="communityId">Community id</label>
    <input id="communityId" type="text">
    <button id="load" type="button">Load</button>
    <p id="error" class="error"></p>
  </section>
  <section class="card">
    <table>
      <thead>
        <tr>
          <th>Community</th><th>Patient</th><th>Name</th><th>Room</th><th>Synthetic CUID</th>
          <th>Source</th><th>First seen</th><th>Last seen</th><th>Last event</th><th></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </section>
  <script>
    const statusEl = document.getElementById('status');
    const communityEl = document.getElementById('communityId');
    const rowsEl = document.getElementById('rows');
    const errorEl = document.getElementById('error');

    function text(value) {
      return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[ch]));
    }

    function nameOf(row) {
      return [row.lastName, row.firstName].filter(Boolean).join(', ');
    }

    function when(value) {
      return value ? new Date(value).toLocaleString() : '';
    }

    async function load() {
      errorEl.textContent = '';
      const params = new URLSearchParams({ status: statusEl.value });
      if (communityEl.value.trim()) params.set('communityId', communityEl.value.trim());
      const response = await fetch('/admin/unmatched-cuids/rows?' + params.toString(), { credentials: 'include' });
      const body = await response.json();
      if (!response.ok) {
        errorEl.textContent = body.error || 'Unable to load rows';
        rowsEl.innerHTML = '';
        return;
      }
      rowsEl.innerHTML = body.rows.map((row) => {
        const resolve = row.status === 'open'
          ? '<button type="button" data-id="' + row.id + '">Resolve</button>'
          : '';
        return '<tr><td>' + text(row.communityId) + '</td><td>' + text(row.externalResidentId) + '</td><td>'
          + text(nameOf(row)) + '</td><td>' + text(row.roomNumber || '') + '</td><td>' + text(row.syntheticCuid)
          + '</td><td>' + text(row.source) + '</td><td>' + text(when(row.firstSeenAt)) + '</td><td>'
          + text(when(row.lastSeenAt)) + '</td><td>' + text(row.lastEventType) + '</td><td>' + resolve + '</td></tr>';
      }).join('');
    }

    rowsEl.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      const response = await fetch('/admin/unmatched-cuids/' + button.dataset.id + '/resolve', {
        method: 'POST',
        credentials: 'include',
      });
      const body = await response.json();
      if (!response.ok) {
        errorEl.textContent = body.error || 'Unable to resolve row';
        return;
      }
      await load();
    });

    document.getElementById('load').addEventListener('click', load);
    load();
  </script>
</body>
</html>
```

- [ ] **Step 4: Run the route tests**

Run: `npx jest tests/http/unmatchedCuid.routes.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/http/routes.ts public/unmatched-cuids.html tests/http/unmatchedCuid.routes.test.ts
git commit -m "feat: add admin page for unmatched room CUIDs"
```

---

### Task 6: HL7 tester result

**Files:**
- Modify: `src/admin/yardiHl7Test.ts`
- Modify: `tests/admin/yardiHl7Test.test.ts`
- Test: `tests/admin/yardiHl7Test.test.ts`

**Interfaces:**
- Consumes: `prisma.unmatchedCuid.findFirst`
- Produces: `YardiHl7TestResult.syntheticCuid: string | null`

- [ ] **Step 1: Extend the prisma mock and write the failing assertion**

In `tests/admin/yardiHl7Test.test.ts`, add `const unmatchedFindFirstMock = jest.fn();` and add this to the prisma mock:

```ts
unmatchedCuid: {
  findFirst: (...args: unknown[]) => unmatchedFindFirstMock(...args),
},
```

In the existing `beforeEach`, add `unmatchedFindFirstMock.mockResolvedValue(null);`.

Add this test inside the existing `runYardiHl7Test` describe:

```ts
it('returns the synthetic CUID opened by the run', async () => {
  recordIncomingEventMock.mockImplementation(async (event: { eventMessageId: string; eventType: string }) => ({
    eventLog: {
      id: 99,
      eventMessageId: event.eventMessageId,
      eventType: event.eventType,
      status: 'received',
      communityId: 113,
      error: null,
      payload: {},
    },
    company: { id: 10, companyKey: 'yourlife' },
    isDuplicate: false,
  }));
  eventLogFindUniqueMock.mockResolvedValue({
    id: 99,
    eventMessageId: 'x',
    eventType: 'hl7.adt.a01',
    status: 'processed',
    communityId: 113,
    error: null,
    payload: {},
    company: { companyKey: 'yourlife' },
  });
  issueFindManyMock.mockResolvedValue([]);
  getCommunityEnrichmentMock.mockResolvedValue({});
  unmatchedFindFirstMock.mockResolvedValueOnce({ syntheticCuid: 'COMM-113-141' });

  const result = await runYardiHl7Test({
    mode: 'inline',
    source: 'form',
    trigger: 'A01',
    residentId: '418612',
    roomNumber: '141',
    facilityId: 'EYELIVE',
  });

  expect(result.syntheticCuid).toBe('COMM-113-141');
  expect(result.caspio.skipReason).not.toBe('missing_cuid');
  expect(unmatchedFindFirstMock).toHaveBeenCalledWith({
    where: { companyId: 10, lastEventMessageId: result.event.eventMessageId },
    orderBy: { lastSeenAt: 'desc' },
  });
});
```

On the existing inline form success test that expects `result.success` to be true, add `expect(result.syntheticCuid).toBeNull();`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/admin/yardiHl7Test.test.ts --runInBand`

Expected: FAIL because `result.syntheticCuid` is `undefined`.

- [ ] **Step 3: Return syntheticCuid and stop inferring missing_cuid**

On `YardiHl7TestResult`, add `syntheticCuid: string | null`.

Delete this block in `runYardiHl7Test`:

```ts
if (issues.some((issue) => /cuid/i.test(issue.message))) {
  skipReason = 'missing_cuid';
}
```

Before each `return` that builds a `YardiHl7TestResult`, load:

```ts
const unmatched = recorded.company?.id
  ? await prisma.unmatchedCuid.findFirst({
      where: {
        companyId: recorded.company.id,
        lastEventMessageId: event.eventMessageId,
      },
      orderBy: { lastSeenAt: 'desc' },
    })
  : null;
```

Set `syntheticCuid: unmatched?.syntheticCuid ?? null` on every result object, including the failure return. Keep `'missing_cuid'` in the `YardiHl7SkipReason` union so older result readers still typecheck. Nothing in this function assigns it.

- [ ] **Step 4: Run the tester tests**

Run: `npx jest tests/admin/yardiHl7Test.test.ts tests/http/yardiHl7Test.routes.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/yardiHl7Test.ts tests/admin/yardiHl7Test.test.ts
git commit -m "feat: report synthetic CUID from the HL7 tester"
```

---

### Task 7: Setup doc

**Files:**
- Modify: `docs/yardi-community-setup.md`

**Interfaces:**
- Consumes: the behavior from Tasks 3, 4, and 5
- Produces: setup instructions that match the spec

- [ ] **Step 1: Replace the missing-room instructions**

Replace the "Until a room row exists" bullets and the following sentence with:

```md
Until a room row exists:

- HL7 writes the patient under `COMM-{communityId}-{room}` and opens an `UnmatchedCuid` row. It does not skip the patient write.
- FHIR writes the patient under that same synthetic id, skips the community insert, and opens the same kind of Postgres row.

If you do not yet know the rooms, you can add the roster in step 4 and wait to create room rows. Live events for unknown rooms are stored, written under the synthetic id, and listed at `/admin/unmatched-cuids` until someone resolves them.
```

In the `/monitor` result table, replace the `missing_cuid` row with:

```md
| Synthetic `CUID` | The room has no Caspio `CUID`. The patient was written under `COMM-{communityId}-{room}`. Open rows are at `/admin/unmatched-cuids`. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/yardi-community-setup.md
git commit -m "docs: point missing room CUIDs at the unmatched worklist"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| `UnmatchedCuid` model, unique key, indexes, both schemas | Task 1 |
| Insert, refresh, reopen, blank patient number, swallowed write error | Task 2 |
| List defaults, filters, unknown status, resolve, idempotent resolve, missing id | Task 2 and Task 5 |
| HL7 A01 synthetic write and real-CUID silence | Task 3 |
| A05 does not retarget a different `CUID` | Task 3 |
| A02 moves onto the synthetic destination | Task 3 |
| A08 and A60 leave a different `CUID` alone; missing patient records `patient_not_found` | Task 3 |
| A03, A21, and A22 update only a synthetic row | Task 3 |
| Thrown Caspio write skips the worklist | Task 3 and Task 4 |
| FHIR synthetic push records the row and skips the community insert | Task 4 |
| Real FHIR `CUID` does not open a row | Task 4 |
| Admin page, auth, resolve does not call Caspio | Task 5 |
| HL7 tester returns `syntheticCuid` and stops reporting `missing_cuid` | Task 6 |
| Setup doc | Task 7 |
| No automatic Caspio move, care-plan sync unchanged, no community insert | Global Constraints; no task changes those paths |
