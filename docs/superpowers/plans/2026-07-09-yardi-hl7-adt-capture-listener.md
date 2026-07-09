# Yardi HL7 ADT Capture Listener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept raw HL7 (and existing JSON) on `POST /webhook/yardi/hl7`, persist to EventLog, return dual ACK, and never enqueue BullMQ for `yardi-hl7`.

**Architecture:** Extend the existing Yardi HL7 adapter and webhook handler. Add text body parsing for the HL7 route, normalize raw MSH into a `CanonicalInboundEvent` with placeholder `CompanyKey` `yardi`, mark events `capture_only` via `markEventIgnored`, and respond with HL7 ACK (raw) or JSON (JSON). Reuse `/monitor` as-is.

**Tech Stack:** Express, Zod, Jest, Supertest, existing EHR adapter / EventLog pipeline

**Spec:** `docs/superpowers/specs/2026-07-09-yardi-hl7-adt-capture-listener-design.md`

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/integrations/ehr/hl7Ack.ts` | Build minimal HL7 ACK (`MSA|AA/AE/AR`) from inbound MSH |
| `src/integrations/ehr/yardiHl7AdtAdapter.ts` | Accept raw HL7 string or JSON; extract MSH.3–6 / MSH.7 / MSH.10 |
| `src/http/middleware/parseYardiHl7Body.ts` | Ensure HL7 route can read text/plain (and similar) bodies |
| `src/http/app.ts` or `src/http/routes.ts` | Mount text parser for `/webhook/yardi/hl7` |
| `src/webhook/handler.ts` | Capture-only gate + dual ACK responses for `yardi-hl7` |
| `tests/integrations/ehr/hl7Ack.test.ts` | ACK unit tests |
| `tests/integrations/ehr/yardiHl7AdtAdapter.test.ts` | Raw + JSON adapter tests |
| `tests/http/webhook.test.ts` | HTTP capture-only + ACK integration tests |

---

### Task 1: HL7 ACK helper

**Files:**
- Create: `src/integrations/ehr/hl7Ack.ts`
- Test: `tests/integrations/ehr/hl7Ack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/ehr/hl7Ack.test.ts`:

```ts
import { buildHl7Ack } from '../../../src/integrations/ehr/hl7Ack.js';

const SAMPLE_MSH =
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5';

describe('buildHl7Ack', () => {
  it('builds AA ACK swapping sending/receiving apps and facilities', () => {
    const ack = buildHl7Ack({ inboundMessage: SAMPLE_MSH + '\rEVN|A01', ackCode: 'AA' });
    const lines = ack.split(/\r/);
    expect(lines[0]).toMatch(/^MSH\|/);
    expect(lines[0]).toContain('|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|');
    expect(lines[0]).toContain('|ACK^A01|');
    expect(lines[0]).toContain('|10529|');
    expect(lines[1]).toBe('MSA|AA|10529');
  });

  it('builds AE ACK for validation failures', () => {
    const ack = buildHl7Ack({
      inboundMessage: SAMPLE_MSH,
      ackCode: 'AE',
      textMessage: 'Invalid payload',
    });
    expect(ack).toContain('MSA|AE|10529|Invalid payload');
  });

  it('builds AR ACK when control id is missing', () => {
    const ack = buildHl7Ack({
      inboundMessage: 'not-hl7',
      ackCode: 'AR',
      textMessage: 'Persist failed',
    });
    expect(ack).toContain('MSA|AR|UNKNOWN|Persist failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integrations/ehr/hl7Ack.test.ts --runInBand`

Expected: FAIL (module not found / `buildHl7Ack` not defined)

- [ ] **Step 3: Write minimal implementation**

Create `src/integrations/ehr/hl7Ack.ts`:

```ts
export type Hl7AckCode = 'AA' | 'AE' | 'AR';

export type BuildHl7AckArgs = {
  inboundMessage: string;
  ackCode: Hl7AckCode;
  textMessage?: string;
};

function firstSegment(message: string, prefix: string): string | undefined {
  return message
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix));
}

function field(segment: string | undefined, index: number): string {
  if (!segment) return '';
  // MSH field indexing: after "MSH", field 1 is the separator "|", so split keeps empty first? 
  // Standard: split by | → [ "MSH", "^~\\&", app, facility, ... ]
  // MSH.3 = parts[2], MSH.4 = parts[3], MSH.5 = parts[4], MSH.6 = parts[5]
  // MSH.7 = parts[6], MSH.9 = parts[8], MSH.10 = parts[9], MSH.11 = parts[10], MSH.12 = parts[11]
  const parts = segment.split('|');
  return parts[index] ?? '';
}

function nowHl7Timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/**
 * Build a minimal HL7 ACK from an inbound ADT message.
 * Swaps MSH sending/receiving application + facility.
 */
export function buildHl7Ack(args: BuildHl7AckArgs): string {
  const msh = firstSegment(args.inboundMessage, 'MSH|');
  const encoding = field(msh, 1) || '^~\\&';
  const sendingApp = field(msh, 2); // inbound MSH.3
  const sendingFac = field(msh, 3); // inbound MSH.4
  const receivingApp = field(msh, 4); // inbound MSH.5
  const receivingFac = field(msh, 5); // inbound MSH.6
  const trigger = (field(msh, 8).split('^')[1] || 'ACK').trim() || 'ACK';
  const controlId = field(msh, 9) || 'UNKNOWN';
  const processingId = field(msh, 10) || 'P';
  const version = field(msh, 11) || '2.5';

  const ackMsh = [
    'MSH',
    encoding,
    receivingApp, // we are EyeWatchLive
    receivingFac,
    sendingApp, // back to Yardi
    sendingFac,
    nowHl7Timestamp(),
    '',
    `ACK^${trigger}`,
    controlId,
    processingId,
    version,
  ].join('|');

  const msaParts = ['MSA', args.ackCode, controlId];
  if (args.textMessage) {
    msaParts.push(args.textMessage);
  }
  return `${ackMsh}\r${msaParts.join('|')}`;
}
```

Note: Verify field indexes against the sample in the test. If `encoding` ends up wrong because MSH.1 is the `|` delimiter itself, adjust so the ACK MSH still starts with `MSH|^~\&|...` matching the test assertion `|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integrations/ehr/hl7Ack.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/ehr/hl7Ack.ts tests/integrations/ehr/hl7Ack.test.ts
git commit -m "feat(yardi-hl7): add HL7 ACK builder"
```

---

### Task 2: Parse raw HL7 in YardiHl7AdtAdapter

**Files:**
- Modify: `src/integrations/ehr/yardiHl7AdtAdapter.ts`
- Test: `tests/integrations/ehr/yardiHl7AdtAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/integrations/ehr/yardiHl7AdtAdapter.test.ts`:

```ts
const SAMPLE_YARDI_RAW = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('YardiHl7AdtAdapter raw HL7', () => {
  it('parses a raw HL7 string into a canonical event', () => {
    const adapter = new YardiHl7AdtAdapter();
    const event = adapter.parseInboundEvent(SAMPLE_YARDI_RAW);

    expect(event).toMatchObject({
      source: 'yardi-hl7',
      companyKey: 'yardi',
      communityId: null,
      eventType: 'hl7.adt.a01',
      eventMessageId: '10529',
      lifecycleKind: 'move_in',
      notificationData: expect.objectContaining({
        TriggerEvent: 'A01',
        ResidentId: 418612,
        SendingApplication: 'Yardi',
        SendingFacility: 'EYELIVE',
        ReceivingApplication: 'EyeWatchLive',
        ReceivingFacility: 'EyeWatchLive',
      }),
    });
    expect(event.eventMessageDate).toMatch(/2022-09-08/);
    expect((event.raw as { message?: string }).message).toContain('MSH|');
  });

  it('still parses the existing JSON envelope', () => {
    const adapter = new YardiHl7AdtAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'yardi-company',
      CommunityId: 113,
      EventMessageId: 'hl7-evt-1',
      EventMessageDate: '2026-04-03T12:00:00Z',
      Message: SAMPLE_ADT_A01,
    });
    expect(event.companyKey).toBe('yardi-company');
    expect(event.communityId).toBe(113);
    expect(event.eventMessageId).toBe('hl7-evt-1');
  });

  it('rejects non-HL7 strings', () => {
    const adapter = new YardiHl7AdtAdapter();
    expect(() => adapter.parseInboundEvent('hello')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integrations/ehr/yardiHl7AdtAdapter.test.ts --runInBand`

Expected: FAIL on raw string parse (Zod expects object)

- [ ] **Step 3: Update adapter to accept raw HL7**

In `src/integrations/ehr/yardiHl7AdtAdapter.ts`:

1. Extend `ParsedHl7Message` (or a sibling type) to include MSH header fields:

```ts
type ParsedHl7Message = {
  triggerEvent: string;
  messageControlId?: string;
  messageDateTime?: string;
  sendingApplication?: string;
  sendingFacility?: string;
  receivingApplication?: string;
  receivingFacility?: string;
  residentId?: number;
  patientFirstName?: string;
  patientLastName?: string;
  dateOfBirth?: string;
  roomNumber?: string;
  bed?: string;
  residentStatus?: string;
};
```

2. In `parseHl7Message`, also read the MSH segment:

```ts
const msh = segments.find((line) => line.startsWith('MSH|'));
// MSH parts: [MSH, ^~\&, app, fac, rcvApp, rcvFac, datetime, security, ADT^A01, controlId, ...]
const mshParts = (msh ?? '').split('|');
const sendingApplication = mshParts[2];
const sendingFacility = mshParts[3];
const receivingApplication = mshParts[4];
const receivingFacility = mshParts[5];
const messageDateTime = mshParts[6];
const messageControlId = mshParts[9];
```

Keep existing EVN/PID/PV1 logic. Return the new MSH fields on the parsed object.

3. Add helper to normalize MSH.7 `yyyyMMddHHmmss` → ISO string (fallback: `new Date().toISOString()` if unparseable).

4. Change `parseInboundEvent`:

```ts
parseInboundEvent(payload: unknown): CanonicalInboundEvent {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed.startsWith('MSH|')) {
      throw new Error('Raw HL7 payload must start with MSH|');
    }
    const hl7 = parseHl7Message(trimmed);
    if (!hl7.messageControlId) {
      throw new Error('HL7 message missing MSH.10 control ID');
    }
    return {
      source: this.source,
      companyKey: 'yardi',
      communityId: null,
      eventType: `hl7.adt.${hl7.triggerEvent.toLowerCase()}`,
      eventMessageId: hl7.messageControlId,
      eventMessageDate: normalizeHl7DateTime(hl7.messageDateTime) ?? new Date().toISOString(),
      lifecycleKind: toLifecycle(hl7.triggerEvent),
      notificationData: {
        TriggerEvent: hl7.triggerEvent,
        ResidentId: hl7.residentId ?? null,
        SendingApplication: hl7.sendingApplication ?? null,
        SendingFacility: hl7.sendingFacility ?? null,
        ReceivingApplication: hl7.receivingApplication ?? null,
        ReceivingFacility: hl7.receivingFacility ?? null,
      },
      raw: {
        message: trimmed,
        parsed: hl7,
      },
    };
  }

  // existing JSON path — also enrich notificationData with MSH fields from parsed.Message when present
  const parsed = YardiHl7WebhookSchema.parse(payload);
  const hl7 = parseHl7Message(parsed.Message);
  // ... existing return, plus MSH fields in notificationData
}
```

Implement `normalizeHl7DateTime` similarly to `parseHl7Date` but include time if present (`yyyyMMddHHmmss` → ISO).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integrations/ehr/yardiHl7AdtAdapter.test.ts --runInBand`

Expected: PASS (existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/ehr/yardiHl7AdtAdapter.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts
git commit -m "feat(yardi-hl7): parse raw HL7 ADT webhook bodies"
```

---

### Task 3: Text body parsing for `/webhook/yardi/hl7`

**Files:**
- Create: `src/http/middleware/parseYardiHl7Body.ts`
- Modify: `src/http/routes.ts` (mount middleware on HL7 route)
- Test: covered in Task 4 HTTP tests; optional unit not required if HTTP test covers it

- [ ] **Step 1: Add middleware**

Create `src/http/middleware/parseYardiHl7Body.ts`:

```ts
import type { RequestHandler } from 'express';
import express from 'express';

const textParser = express.text({
  type: [
    'text/plain',
    'application/hl7-v2',
    'application/hl7-v2+er7',
    'x-application/hl7-v2+er7',
  ],
  limit: '1mb',
});

/**
 * Ensures raw HL7 posts are available as a string on req.body.
 * JSON posts are left to the global express.json() parser.
 */
export const parseYardiHl7Body: RequestHandler = (req, res, next) => {
  const contentType = req.headers['content-type'] ?? '';
  const isJson = contentType.includes('application/json');
  if (isJson) {
    next();
    return;
  }
  textParser(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }
    // If body is still empty/undefined and content-type was missing, try text anyway
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      req.body = String(req.body);
    }
    next();
  });
};
```

- [ ] **Step 2: Mount on the HL7 route**

In `src/http/routes.ts`, update the HL7 route:

```ts
import { parseYardiHl7Body } from './middleware/parseYardiHl7Body.js';

router.post(
  '/webhook/yardi/hl7',
  authWebhook,
  parseYardiHl7Body,
  async (req, res, next) => {
    try {
      await handleWebhookBySource('yardi-hl7', req, res);
    } catch (error) {
      next(error);
    }
  },
);
```

Important: Global `express.json()` runs first. For `Content-Type: text/plain`, JSON middleware typically leaves `req.body` undefined/`{}` and does not consume incorrectly if type doesn't match — verify with a quick HTTP test in Task 4. If text posts arrive as `{}`, also register in `createApp()`:

```ts
app.use(
  express.text({
    type: ['text/plain', 'application/hl7-v2', 'application/hl7-v2+er7'],
    limit: '1mb',
  }),
);
```

Prefer route middleware first; fall back to app-level only if tests show body is empty.

- [ ] **Step 3: Commit**

```bash
git add src/http/middleware/parseYardiHl7Body.ts src/http/routes.ts src/http/app.ts
git commit -m "feat(yardi-hl7): accept text/plain HL7 webhook bodies"
```

---

### Task 4: Capture-only handler + dual ACK

**Files:**
- Modify: `src/webhook/handler.ts`
- Modify: `tests/http/webhook.test.ts`

- [ ] **Step 1: Write the failing HTTP tests**

Append to `tests/http/webhook.test.ts` (reuse existing mocks at top of file):

```ts
const SAMPLE_YARDI_HL7 = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('POST /webhook/yardi/hl7', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures raw HL7, does not enqueue, returns HL7 ACK', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 501 },
      company: { id: 20, companyKey: 'yardi' },
      isDuplicate: false,
    });
    markEventIgnoredMock.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .set('Content-Type', 'text/plain')
      .send(SAMPLE_YARDI_HL7);

    expect(response.status).toBe(202);
    expect(response.text).toContain('MSA|AA|10529');
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 20,
        eventMessageId: '10529',
        source: 'yardi-hl7',
      }),
      'capture_only',
    );
    expect(recordIncomingEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yardi-hl7',
        companyKey: 'yardi',
        eventMessageId: '10529',
      }),
    );
  });

  it('captures JSON envelope without enqueueing and returns JSON', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 502 },
      company: { id: 20, companyKey: 'yardi-company' },
      isDuplicate: false,
    });
    markEventIgnoredMock.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .send({
        CompanyKey: 'yardi-company',
        CommunityId: 113,
        EventMessageId: 'json-1',
        EventMessageDate: '2026-04-03T12:00:00Z',
        Message: SAMPLE_YARDI_HL7,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'received', id: 502 });
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(markEventIgnoredMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventMessageId: 'json-1', source: 'yardi-hl7' }),
      'capture_only',
    );
  });

  it('returns HL7 AE ACK for invalid raw body', async () => {
    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .set('Content-Type', 'text/plain')
      .send('not-a-message');

    expect(response.status).toBe(400);
    expect(response.text).toContain('MSA|AE|');
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('returns HL7 AA ACK for duplicate raw HL7 without enqueueing', async () => {
    recordIncomingEventMock.mockResolvedValueOnce({
      eventLog: { id: 503 },
      company: { id: 20, companyKey: 'yardi' },
      isDuplicate: true,
    });

    const response = await request(app)
      .post('/webhook/yardi/hl7')
      .set('Authorization', authHeader)
      .set('Content-Type', 'text/plain')
      .send(SAMPLE_YARDI_HL7);

    expect(response.status).toBe(200);
    expect(response.text).toContain('MSA|AA|10529');
    expect(queueAddMock).not.toHaveBeenCalled();
  });
});
```

Also mock `recordEventIssue` if the capture path records an issue — if not, no change. Current handler imports `recordEventIssue`; capture_only can skip issue recording (ignored reason is enough). Prefer **not** recording an EventProcessingIssue for happy-path capture to avoid noise.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/http/webhook.test.ts --runInBand`

Expected: FAIL — raw HL7 currently 400 JSON; successful path would enqueue

- [ ] **Step 3: Implement capture-only + dual ACK in handler**

Update `src/webhook/handler.ts`:

1. Import `buildHl7Ack`.
2. Add helpers:

```ts
function isRawHl7Body(body: unknown): body is string {
  return typeof body === 'string';
}

function sendYardiHl7Response(
  req: Request,
  res: Response,
  args: {
    status: number;
    ackCode: 'AA' | 'AE' | 'AR';
    jsonBody: Record<string, unknown>;
    textMessage?: string;
  },
): Response {
  if (isRawHl7Body(req.body)) {
    const ack = buildHl7Ack({
      inboundMessage: req.body,
      ackCode: args.ackCode,
      textMessage: args.textMessage,
    });
    res.status(args.status);
    res.type('text/plain');
    return res.send(ack);
  }
  return res.status(args.status).json(args.jsonBody);
}
```

3. On parse failure for `yardi-hl7`, use dual response:

```ts
} catch (error) {
  logger.warn({ source, error: ... }, 'webhook_validation_failed');
  if (source === 'yardi-hl7') {
    return sendYardiHl7Response(req, res, {
      status: 400,
      ackCode: 'AE',
      jsonBody: {
        error: 'Invalid payload',
        details: error instanceof Error ? error.message : 'schema_parse_failed',
      },
      textMessage: error instanceof Error ? error.message : 'Invalid payload',
    });
  }
  return res.status(400).json({ ... });
}
```

4. After `recordIncomingEvent`, for duplicates when `source === 'yardi-hl7'`:

```ts
if (isDuplicate) {
  if (source === 'yardi-hl7') {
    return sendYardiHl7Response(req, res, {
      status: 200,
      ackCode: 'AA',
      jsonBody: { status: 'duplicate' },
    });
  }
  return res.status(200).json({ status: 'duplicate' });
}
```

5. **Before enqueue**, add capture-only gate:

```ts
if (source === 'yardi-hl7') {
  await markEventIgnored(
    {
      companyId: company.id,
      eventType: event.eventType,
      eventMessageId: event.eventMessageId,
      source: event.source,
    },
    'capture_only',
  );
  logger.info(
    {
      eventMessageId: event.eventMessageId,
      eventType: event.eventType,
      source,
      companyId: company.id,
    },
    'webhook_event_captured',
  );
  return sendYardiHl7Response(req, res, {
    status: 202,
    ackCode: 'AA',
    jsonBody: { status: 'received', id: eventLog.id },
  });
}
```

Place this after the `test.event` / unsupported checks (or before enqueue — for `yardi-hl7`, `supportsEventType` is always true, so either works). Simplest: insert immediately before building `jobData`.

6. Leave ALIS / yardi-fhir enqueue path unchanged.

Do **not** wrap persist failures specially unless easy: unhandled errors still hit the Express error middleware (JSON 500). Optional improvement: try/catch around `recordIncomingEvent` for `yardi-hl7` to return `MSA|AR` — include if tests need it; otherwise YAGNI for v1 (spec allows AR on persist failure; add a focused try/catch):

```ts
let recorded;
try {
  recorded = await recordIncomingEvent(event);
} catch (persistError) {
  if (source === 'yardi-hl7') {
    return sendYardiHl7Response(req, res, {
      status: 500,
      ackCode: 'AR',
      jsonBody: { error: 'Persist failed' },
      textMessage: persistError instanceof Error ? persistError.message : 'Persist failed',
    });
  }
  throw persistError;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/http/webhook.test.ts --runInBand`

Expected: PASS (ALIS tests unchanged + new Yardi HL7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/webhook/handler.ts tests/http/webhook.test.ts
git commit -m "feat(yardi-hl7): capture-only webhook with dual ACK"
```

---

### Task 5: Full regression + manual smoke checklist

**Files:** none (verification only)

- [ ] **Step 1: Run full unit suite for touched areas**

Run:

```bash
npx jest tests/integrations/ehr/hl7Ack.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/http/webhook.test.ts --runInBand
```

Expected: all PASS

- [ ] **Step 2: Manual smoke (local or deployed)**

With API running and webhook BasicAuth configured:

```bash
curl -sS -u "$WEBHOOK_BASIC_USER:$WEBHOOK_BASIC_PASS" \
  -H "Content-Type: text/plain" \
  --data-binary @- \
  "http://localhost:3000/webhook/yardi/hl7" <<'EOF'
MSH|^~\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209||ADT^A01|10529|P|2.5
EVN|A01|20220908043209
PID|1||418612||Morgan^Denise^||20220901000000|F
PV1|1|I^Current|AZone1^141^Single^EYELIVE
EOF
```

Expected response body contains `MSA|AA|10529`.

Then open `/monitor` (admin auth) and confirm a `yardi-hl7` / `hl7.adt.a01` event with MSH IDs in payload.

- [ ] **Step 3: Commit any leftover fixes** (only if smoke found bugs)

```bash
git status
# if fixes: commit with message describing the fix
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Extend `POST /webhook/yardi/hl7` | 3, 4 |
| Accept raw HL7 + JSON | 2, 3, 4 |
| Persist EventLog, no enqueue | 4 |
| Dual ACK (HL7 / JSON) | 1, 4 |
| Placeholder `CompanyKey` `yardi`, `CommunityId` null | 2 |
| Store MSH.3–6 for verification | 2 |
| AE/AR on errors | 1, 4 |
| Reuse monitor | no code (existing) |
| ALIS / FHIR unchanged | 4 (gate is source-scoped) |
| Unit + HTTP tests | 1, 2, 4, 5 |

## Ready-for-Yardi (after deploy)

1. URL: `https://<host>/webhook/yardi/hl7`
2. BasicAuth: `WEBHOOK_BASIC_USER` / `WEBHOOK_BASIC_PASS`
3. MSH IDs: `Yardi` / `EYELIVE` / `EyeWatchLive` / `EyeWatchLive`
4. Ask Yardi to send a test ADT; verify in `/monitor`
