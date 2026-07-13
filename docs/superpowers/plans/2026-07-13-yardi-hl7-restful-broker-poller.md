# Yardi HL7 Restful Message Broker Poller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll Yardi GetMessage for HL7 ADT, capture to EventLog (`capture_only`), ProcessACK on success/duplicate, remove the push webhook path.

**Architecture:** BullMQ repeatable poller (like Yardi FHIR poll) calls a broker client that POSTs `text/xml` to GetMessage/ProcessACK with MSH.8.1 password. Raw ADT is parsed via existing `YardiHl7AdtAdapter`, persisted, ignored as `capture_only`, then ACKed. `POST /webhook/yardi/hl7` is removed.

**Tech Stack:** Express (existing), Axios (`createHttpClient`), BullMQ, Zod env, Jest

**Spec:** `docs/superpowers/specs/2026-07-13-yardi-hl7-restful-broker-poller-design.md`

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/config/env.ts` | Yardi HL7 poll env vars |
| `.env.example` | Document new vars (no real password) |
| `src/integrations/yardi/yardiHl7BrokerXml.ts` | Pure XML/HL7 request+response builders/parsers |
| `src/integrations/yardi/yardiHl7BrokerClient.ts` | HTTP GetMessage / ProcessACK |
| `src/integrations/yardi/yardiHl7PollCapture.ts` | Drain loop: get → capture → ack |
| `src/workers/yardiHl7Poll.ts` | Worker + schedule registration |
| `src/workers/queue.ts` / `types.ts` / `index.ts` | Queue wiring |
| `src/http/routes.ts` | Remove HL7 webhook route |
| `src/http/middleware/parseYardiHl7Body.ts` | Delete |
| `src/webhook/handler.ts` | Remove yardi-hl7-specific dual-ACK / capture gate (no longer needed for HTTP) |
| Tests under `tests/integrations/yardi/` and `tests/workers/` / `tests/http/` | TDD coverage |

---

### Task 1: Env configuration

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/config/yardiHl7Env.test.ts` (optional light parse test — skip if project has no env unit tests; then validate via TypeScript compile only)

- [ ] **Step 1: Add env fields to `EnvSchema` in `src/config/env.ts`**

Inside the Zod object (near other YARDI_FHIR_* keys), add:

```ts
    YARDI_HL7_POLL_ENABLED: z
      .union([z.string(), z.boolean()])
      .default('false')
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        return val.toLowerCase() === 'true';
      }),
    YARDI_HL7_POLL_INTERVAL_MS: z.coerce.number().default(300_000),
    YARDI_HL7_POLL_MAX_MESSAGES: z.coerce.number().default(50),
    YARDI_HL7_GET_MESSAGE_URL: z
      .string()
      .url()
      .default('https://test.yardimirthus.com:1021/HL7/GetMessage'),
    YARDI_HL7_PROCESS_ACK_URL: z
      .string()
      .url()
      .default('https://test.yardimirthus.com:1024/HL7/ProcessACK/'),
    YARDI_HL7_MAILBOX_PASSWORD: z.string().optional(),
    YARDI_HL7_SENDING_APPLICATION: z.string().default('EyeWatchLive'),
    YARDI_HL7_SENDING_FACILITY: z.string().default('EyeWatchLive'),
    YARDI_HL7_RECEIVING_APPLICATION: z.string().default('Yardi'),
    YARDI_HL7_RECEIVING_FACILITY: z.string().default('EYELIVE'),
```

Do **not** put the real password in the repo.

- [ ] **Step 2: Document in `.env.example`**

Append:

```env
# Yardi HL7 Restful Message Broker (poll)
YARDI_HL7_POLL_ENABLED=false
YARDI_HL7_POLL_INTERVAL_MS=300000
YARDI_HL7_POLL_MAX_MESSAGES=50
YARDI_HL7_GET_MESSAGE_URL=https://test.yardimirthus.com:1021/HL7/GetMessage
YARDI_HL7_PROCESS_ACK_URL=https://test.yardimirthus.com:1024/HL7/ProcessACK/
YARDI_HL7_MAILBOX_PASSWORD=
YARDI_HL7_SENDING_APPLICATION=EyeWatchLive
YARDI_HL7_SENDING_FACILITY=EyeWatchLive
YARDI_HL7_RECEIVING_APPLICATION=Yardi
YARDI_HL7_RECEIVING_FACILITY=EYELIVE
```

- [ ] **Step 3: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat(yardi-hl7): add Restful broker poll env config"
```

---

### Task 2: Broker XML builders/parsers (pure)

**Files:**
- Create: `src/integrations/yardi/yardiHl7BrokerXml.ts`
- Test: `tests/integrations/yardi/yardiHl7BrokerXml.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integrations/yardi/yardiHl7BrokerXml.test.ts`:

```ts
import {
  buildGetMessageRequestXml,
  buildProcessAckXml,
  classifyGetMessageResponse,
  extractHl7FromBrokerResponseXml,
  type YardiHl7BrokerIdentity,
} from '../../../src/integrations/yardi/yardiHl7BrokerXml.js';

const identity: YardiHl7BrokerIdentity = {
  sendingApplication: 'EyeWatchLive',
  sendingFacility: 'EyeWatchLive',
  receivingApplication: 'Yardi',
  receivingFacility: 'EYELIVE',
  password: 'test-pass',
};

describe('yardiHl7BrokerXml', () => {
  it('builds GetMessage XML with QBP^Q11 and MSH.8.1 password', () => {
    const xml = buildGetMessageRequestXml({
      identity,
      messageControlId: '20220531010620',
      dateTime: '20220531010620',
    });
    expect(xml).toContain('<HL7MessageBroker>');
    expect(xml).toContain('<request>');
    expect(xml).toContain('QBP^Q11');
    expect(xml).toContain('|test-pass|');
    expect(xml).toContain('EyeWatchLive');
    expect(xml).toContain('EYELIVE');
    // HL7 special chars escaped for XML
    expect(xml).toContain('^~\\&amp;');
  });

  it('classifies empty mailbox response', () => {
    const hl7 =
      'MSH|^~\\&|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|20220906110541|x|ACK^Q11|20220906110541|P|2.4\rMSA|CR|20220906110541\r';
    const xml = `<HL7MessageBroker><response>${hl7.replace(/&/g, '&amp;')}</response></HL7MessageBroker>`;
    const result = classifyGetMessageResponse(xml);
    expect(result.kind).toBe('empty');
  });

  it('classifies ADT payload from response', () => {
    const adt = [
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5',
      'EVN|A01|20220908043209',
      'PID|1||418612||Morgan^Denise^||20220901000000|F',
      'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
    ].join('\r');
    const xml = `<HL7MessageBroker><DestinationIP/><DestinationPort/><response>${adt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</response></HL7MessageBroker>`;
    const result = classifyGetMessageResponse(xml);
    expect(result.kind).toBe('adt');
    if (result.kind === 'adt') {
      expect(result.hl7).toContain('ADT^A01');
      expect(result.hl7).toContain('10529');
    }
  });

  it('classifies error ACK', () => {
    const hl7 =
      'MSH|^~\\&|EyeWatchLive|EyeWatchLive|Yardi|EYELIVE|20220906110525|x|ACK^Q11|id|P|2.4\rMSA|CE|id\r';
    const xml = `<HL7MessageBroker><response>${hl7.replace(/&/g, '&amp;')}</response></HL7MessageBroker>`;
    expect(classifyGetMessageResponse(xml).kind).toBe('error');
  });

  it('builds ProcessACK XML for successful ADT delivery', () => {
    const adt =
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220529100022||ADT^A08|792|P|2.5\rEVN|A08|20210928141035\r';
    const xml = buildProcessAckXml({
      adtMessage: adt,
      identity,
      password: 'mailbox-pwd',
    });
    expect(xml).toContain('<MessageType>ADT</MessageType>');
    expect(xml).toContain('<Operation>ACK</Operation>');
    expect(xml).toContain('<ADTQueue><ID>792</ID></ADTQueue>');
    expect(xml).toContain('<ExternalSoftwareID>EyeWatchLive</ExternalSoftwareID>');
    expect(xml).toContain('<ExternalPharmacyID>EyeWatchLive</ExternalPharmacyID>');
    expect(xml).toContain('<ExternalAppID>Yardi</ExternalAppID>');
    expect(xml).toContain('<ExternalFacilityID>EYELIVE</ExternalFacilityID>');
    expect(xml).toContain('<Password>mailbox-pwd</Password>');
    expect(xml).toContain('<AckCode>0</AckCode>');
    expect(xml).toContain('<AckDescription>Success</AckDescription>');
  });
});
```

Adjust escaping expectations to match a single consistent `escapeXml` helper (see implementation). If `&amp;` for encoding chars is awkward, prefer escaping the whole HL7 string with a helper and assert `xml.includes(escapeXml('^~\\&'))` or that password/IDs appear unescaped only inside the HL7 request after decode — keep tests honest to the implementation.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx jest tests/integrations/yardi/yardiHl7BrokerXml.test.ts --runInBand`

- [ ] **Step 3: Implement `src/integrations/yardi/yardiHl7BrokerXml.ts`**

```ts
export type YardiHl7BrokerIdentity = {
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  password: string;
};

export type GetMessageClassification =
  | { kind: 'adt'; hl7: string }
  | { kind: 'empty' }
  | { kind: 'error'; detail?: string };

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function buildGetMessageRequestXml(args: {
  identity: YardiHl7BrokerIdentity;
  messageControlId: string;
  dateTime: string;
}): string {
  const { identity } = args;
  const msh = [
    'MSH',
    '^~\\&',
    identity.sendingApplication,
    identity.sendingFacility,
    identity.receivingApplication,
    identity.receivingFacility,
    args.dateTime,
    identity.password,
    'QBP^Q11',
    args.messageControlId,
    'P',
    '2.4',
  ].join('|');
  const qpd = 'QPD|Check Mailbox|Q-CM1||';
  const hl7 = `${msh}\r${qpd}\r`;
  return `<HL7MessageBroker><request>${escapeXml(hl7)}</request></HL7MessageBroker>`;
}

export function extractHl7FromBrokerResponseXml(xml: string): string | null {
  const match = xml.match(/<response>([\s\S]*?)<\/response>/i);
  if (!match?.[1]) return null;
  return unescapeXml(match[1].trim());
}

function msaAckCode(hl7: string): string | undefined {
  const msa = hl7.split(/\r?\n|\r/).find((line) => line.startsWith('MSA|'));
  if (!msa) return undefined;
  return msa.split('|')[1];
}

function mshMessageType(hl7: string): string | undefined {
  const msh = hl7.split(/\r?\n|\r/).find((line) => line.startsWith('MSH|'));
  if (!msh) return undefined;
  return msh.split('|')[8]; // MSH.9
}

export function classifyGetMessageResponse(xml: string): GetMessageClassification {
  const hl7 = extractHl7FromBrokerResponseXml(xml);
  if (!hl7) return { kind: 'error', detail: 'missing_response' };

  const type = mshMessageType(hl7) ?? '';
  const ack = msaAckCode(hl7);

  if (type.startsWith('ADT^') || type.startsWith('ADT|')) {
    return { kind: 'adt', hl7 };
  }
  // Some brokers put ADT without relying on MSA
  if (hl7.includes('\rPID|') || hl7.includes('\nPID|')) {
    return { kind: 'adt', hl7 };
  }
  if (ack === 'CR') return { kind: 'empty' };
  if (ack === 'CE' || ack === 'AR' || ack === 'AE') {
    return { kind: 'error', detail: ack };
  }
  if (type.startsWith('ACK')) {
    return ack === 'CR' ? { kind: 'empty' } : { kind: 'error', detail: ack ?? 'ack' };
  }
  return { kind: 'error', detail: 'unrecognized' };
}

export function buildProcessAckXml(args: {
  adtMessage: string;
  identity: YardiHl7BrokerIdentity;
  password: string;
}): string {
  const msh = args.adtMessage.split(/\r?\n|\r/).find((l) => l.startsWith('MSH|')) ?? '';
  const parts = msh.split('|');
  const messageType = (parts[8] ?? 'ADT').split('^')[0] || 'ADT';
  const controlId = parts[9] || 'UNKNOWN';
  // Pharmacy on ACK XML = our software/pharmacy IDs (EyeWatchLive)
  // PharmacyPropertyComm = Yardi app/facility + password
  return [
    '<Message>',
    `<MessageType>${escapeXml(messageType)}</MessageType>`,
    '<Operation>ACK</Operation>',
    `<ADTQueue><ID>${escapeXml(controlId)}</ID></ADTQueue>`,
    '<DestinationChannel></DestinationChannel>',
    '<Pharmacy>',
    `<ExternalSoftwareID>${escapeXml(args.identity.sendingApplication)}</ExternalSoftwareID>`,
    `<ExternalPharmacyID>${escapeXml(args.identity.sendingFacility)}</ExternalPharmacyID>`,
    '</Pharmacy>',
    '<PharmacyPropertyComm>',
    `<ExternalAppID>${escapeXml(args.identity.receivingApplication)}</ExternalAppID>`,
    `<ExternalFacilityID>${escapeXml(args.identity.receivingFacility)}</ExternalFacilityID>`,
    `<Password>${escapeXml(args.password)}</Password>`,
    '</PharmacyPropertyComm>',
    '<Response>',
    '<AckCode>0</AckCode>',
    '<AckDescription>Success</AckDescription>',
    '</Response>',
    '</Message>',
  ].join('');
}
```

Tune `classifyGetMessageResponse` until tests pass (especially ADT detection vs ACK).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx jest tests/integrations/yardi/yardiHl7BrokerXml.test.ts --runInBand`

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7BrokerXml.ts tests/integrations/yardi/yardiHl7BrokerXml.test.ts
git commit -m "feat(yardi-hl7): add Restful broker XML builders and parsers"
```

---

### Task 3: Broker HTTP client

**Files:**
- Create: `src/integrations/yardi/yardiHl7BrokerClient.ts`
- Test: `tests/integrations/yardi/yardiHl7BrokerClient.test.ts`

- [ ] **Step 1: Write failing tests with axios mocked**

```ts
jest.mock('../../../src/config/axios.js', () => ({
  createHttpClient: jest.fn(() => mockHttp),
}));

const mockPost = jest.fn();
const mockHttp = { post: mockPost };

import { YardiHl7BrokerClient } from '../../../src/integrations/yardi/yardiHl7BrokerClient.js';

describe('YardiHl7BrokerClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts GetMessage as text/xml and classifies ADT', async () => {
    const adt =
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5\rPID|1||1||A^B\r';
    mockPost.mockResolvedValueOnce({
      status: 200,
      data: `<HL7MessageBroker><response>${adt.replace(/&/g, '&amp;')}</response></HL7MessageBroker>`,
    });

    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity: {
        sendingApplication: 'EyeWatchLive',
        sendingFacility: 'EyeWatchLive',
        receivingApplication: 'Yardi',
        receivingFacility: 'EYELIVE',
        password: 'secret',
      },
    });

    const result = await client.getMessage();
    expect(mockPost).toHaveBeenCalledWith(
      'https://example.test/GetMessage',
      expect.stringContaining('<HL7MessageBroker>'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'text/xml' }),
      }),
    );
    expect(result.kind).toBe('adt');
  });

  it('posts ProcessACK XML', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: 'ok' });
    const client = new YardiHl7BrokerClient({
      getMessageUrl: 'https://example.test/GetMessage',
      processAckUrl: 'https://example.test/ProcessACK/',
      identity: {
        sendingApplication: 'EyeWatchLive',
        sendingFacility: 'EyeWatchLive',
        receivingApplication: 'Yardi',
        receivingFacility: 'EYELIVE',
        password: 'secret',
      },
    });
    await client.processAck(
      'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220529100022||ADT^A08|792|P|2.5\r',
    );
    expect(mockPost).toHaveBeenCalledWith(
      'https://example.test/ProcessACK/',
      expect.stringContaining('<AckCode>0</AckCode>'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'text/xml' }),
      }),
    );
  });
});
```

Adapt mock of `createHttpClient` to how `src/config/axios.ts` exports it (read that file and match).

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement client**

```ts
import type { AxiosInstance } from 'axios';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';
import {
  buildGetMessageRequestXml,
  buildProcessAckXml,
  classifyGetMessageResponse,
  type GetMessageClassification,
  type YardiHl7BrokerIdentity,
} from './yardiHl7BrokerXml.js';

export type YardiHl7BrokerClientOptions = {
  getMessageUrl: string;
  processAckUrl: string;
  identity: YardiHl7BrokerIdentity;
  http?: AxiosInstance;
};

export class YardiHl7BrokerClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: YardiHl7BrokerClientOptions) {
    this.http =
      options.http ??
      createHttpClient({
        headers: { Accept: 'text/xml' },
      });
  }

  static fromEnv(): YardiHl7BrokerClient {
    if (!env.YARDI_HL7_MAILBOX_PASSWORD) {
      throw new Error('YARDI_HL7_MAILBOX_PASSWORD is required when using the HL7 broker client');
    }
    return new YardiHl7BrokerClient({
      getMessageUrl: env.YARDI_HL7_GET_MESSAGE_URL,
      processAckUrl: env.YARDI_HL7_PROCESS_ACK_URL,
      identity: {
        sendingApplication: env.YARDI_HL7_SENDING_APPLICATION,
        sendingFacility: env.YARDI_HL7_SENDING_FACILITY,
        receivingApplication: env.YARDI_HL7_RECEIVING_APPLICATION,
        receivingFacility: env.YARDI_HL7_RECEIVING_FACILITY,
        password: env.YARDI_HL7_MAILBOX_PASSWORD,
      },
    });
  }

  async getMessage(): Promise<GetMessageClassification> {
    const now = new Date();
    const stamp = formatHl7Timestamp(now);
    const body = buildGetMessageRequestXml({
      identity: this.options.identity,
      messageControlId: stamp,
      dateTime: stamp,
    });
    const response = await this.http.post<string>(this.options.getMessageUrl, body, {
      headers: { 'Content-Type': 'text/xml' },
      responseType: 'text',
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      return { kind: 'error', detail: `http_${response.status}` };
    }
    const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    return classifyGetMessageResponse(data);
  }

  async processAck(adtMessage: string): Promise<void> {
    const body = buildProcessAckXml({
      adtMessage,
      identity: this.options.identity,
      password: this.options.identity.password,
    });
    const response = await this.http.post(this.options.processAckUrl, body, {
      headers: { 'Content-Type': 'text/xml' },
      responseType: 'text',
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`ProcessACK failed with HTTP ${response.status}`);
    }
  }
}

function formatHl7Timestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7BrokerClient.ts tests/integrations/yardi/yardiHl7BrokerClient.test.ts
git commit -m "feat(yardi-hl7): add Restful Message Broker HTTP client"
```

---

### Task 4: Capture drain loop

**Files:**
- Create: `src/integrations/yardi/yardiHl7PollCapture.ts`
- Test: `tests/integrations/yardi/yardiHl7PollCapture.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
const getMessage = jest.fn();
const processAck = jest.fn();
const recordIncomingEvent = jest.fn();
const markEventIgnored = jest.fn();

jest.mock('../../../src/domains/events.js', () => ({
  recordIncomingEvent,
  markEventIgnored,
}));

import { drainYardiHl7Mailbox } from '../../../src/integrations/yardi/yardiHl7PollCapture.js';

const SAMPLE_ADT = [
  'MSH|^~\\&|Yardi|EYELIVE|EyeWatchLive|EyeWatchLive|20220908043209|pwd|ADT^A01|10529|P|2.5',
  'EVN|A01|20220908043209',
  'PID|1||418612||Morgan^Denise^||20220901000000|F',
  'PV1|1|I^Current|AZone1^141^Single^EYELIVE',
].join('\r');

describe('drainYardiHl7Mailbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures ADT, marks capture_only, ProcessACKs, then stops on empty', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: false,
    });
    markEventIgnored.mockResolvedValueOnce(undefined);
    processAck.mockResolvedValueOnce(undefined);

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
    });

    expect(summary).toEqual({ captured: 1, duplicates: 0, empty: true });
    expect(markEventIgnored).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yardi-hl7', eventMessageId: '10529' }),
      'capture_only',
    );
    expect(processAck).toHaveBeenCalledWith(SAMPLE_ADT);
    expect(getMessage).toHaveBeenCalledTimes(2);
  });

  it('ProcessACKs duplicates without markEventIgnored', async () => {
    getMessage
      .mockResolvedValueOnce({ kind: 'adt', hl7: SAMPLE_ADT })
      .mockResolvedValueOnce({ kind: 'empty' });
    recordIncomingEvent.mockResolvedValueOnce({
      eventLog: { id: 1 },
      company: { id: 9 },
      isDuplicate: true,
    });
    processAck.mockResolvedValueOnce(undefined);

    const summary = await drainYardiHl7Mailbox({
      client: { getMessage, processAck } as any,
      maxMessages: 50,
    });

    expect(summary.duplicates).toBe(1);
    expect(markEventIgnored).not.toHaveBeenCalled();
    expect(processAck).toHaveBeenCalled();
  });

  it('throws on broker error without ProcessACK', async () => {
    getMessage.mockResolvedValueOnce({ kind: 'error', detail: 'CE' });
    await expect(
      drainYardiHl7Mailbox({ client: { getMessage, processAck } as any, maxMessages: 50 }),
    ).rejects.toThrow(/broker/i);
    expect(processAck).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement drain**

```ts
import { logger } from '../../config/logger.js';
import { markEventIgnored, recordIncomingEvent } from '../../domains/events.js';
import { YardiHl7AdtAdapter } from '../ehr/yardiHl7AdtAdapter.js';
import type { YardiHl7BrokerClient } from './yardiHl7BrokerClient.js';

export type DrainYardiHl7MailboxArgs = {
  client: Pick<YardiHl7BrokerClient, 'getMessage' | 'processAck'>;
  maxMessages: number;
  adapter?: YardiHl7AdtAdapter;
};

export type DrainYardiHl7MailboxSummary = {
  captured: number;
  duplicates: number;
  empty: boolean;
};

export async function drainYardiHl7Mailbox(
  args: DrainYardiHl7MailboxArgs,
): Promise<DrainYardiHl7MailboxSummary> {
  const adapter = args.adapter ?? new YardiHl7AdtAdapter();
  let captured = 0;
  let duplicates = 0;
  let empty = false;

  for (let i = 0; i < args.maxMessages; i += 1) {
    const result = await args.client.getMessage();
    if (result.kind === 'empty') {
      empty = true;
      break;
    }
    if (result.kind === 'error') {
      throw new Error(`Yardi HL7 broker error: ${result.detail ?? 'unknown'}`);
    }

    const event = adapter.parseInboundEvent(result.hl7);
    const { eventLog, company, isDuplicate } = await recordIncomingEvent(event);

    if (isDuplicate) {
      duplicates += 1;
    } else {
      await markEventIgnored(
        {
          companyId: company.id,
          eventType: event.eventType,
          eventMessageId: event.eventMessageId,
          source: event.source,
        },
        'capture_only',
      );
      captured += 1;
      logger.info(
        {
          eventMessageId: event.eventMessageId,
          eventType: event.eventType,
          eventLogId: eventLog.id,
        },
        'yardi_hl7_message_captured',
      );
    }

    try {
      await args.client.processAck(result.hl7);
    } catch (ackError) {
      logger.warn(
        {
          eventMessageId: event.eventMessageId,
          error: ackError instanceof Error ? ackError.message : String(ackError),
        },
        'yardi_hl7_process_ack_failed',
      );
    }
  }

  return { captured, duplicates, empty };
}
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add src/integrations/yardi/yardiHl7PollCapture.ts tests/integrations/yardi/yardiHl7PollCapture.test.ts
git commit -m "feat(yardi-hl7): add mailbox drain capture loop"
```

---

### Task 5: Poll worker + queue + schedule

**Files:**
- Modify: `src/workers/types.ts`
- Modify: `src/workers/queue.ts`
- Create: `src/workers/yardiHl7Poll.ts`
- Modify: `src/workers/index.ts`
- Test: `tests/workers/yardiHl7Poll.test.ts` (schedule disabled / enabled + drain invoked — mock drain)

- [ ] **Step 1: Add types + queue**

In `types.ts`:

```ts
export type YardiHl7PollJobData = Record<string, never>;
```

In `queue.ts`, add queue `yardi-hl7-poll` analogous to FHIR poll (attempts: 2, backoff 5000).

- [ ] **Step 2: Implement `src/workers/yardiHl7Poll.ts`**

Mirror `yardiFhirPoll.ts`:

- `startYardiHl7PollWorker` → calls `drainYardiHl7Mailbox` with `YardiHl7BrokerClient.fromEnv()` and `env.YARDI_HL7_POLL_MAX_MESSAGES`
- `registerYardiHl7PollSchedule` → if `YARDI_HL7_POLL_ENABLED`, require password, add repeatable job every `YARDI_HL7_POLL_INTERVAL_MS`

- [ ] **Step 3: Wire `src/workers/index.ts`**

Start worker + register schedule; close on shutdown.

- [ ] **Step 4: Unit test schedule gate**

Test that when `YARDI_HL7_POLL_ENABLED` is false, register logs/disabled and does not add job (mock queue). Keep lightweight.

- [ ] **Step 5: Commit**

```bash
git add src/workers/types.ts src/workers/queue.ts src/workers/yardiHl7Poll.ts src/workers/index.ts tests/workers/yardiHl7Poll.test.ts
git commit -m "feat(yardi-hl7): schedule Restful broker poll worker"
```

---

### Task 6: Remove push webhook path

**Files:**
- Modify: `src/http/routes.ts` — remove `/webhook/yardi/hl7` route and `parseYardiHl7Body` import
- Delete: `src/http/middleware/parseYardiHl7Body.ts`
- Modify: `src/webhook/handler.ts` — remove `buildHl7Ack`, `sendYardiHl7Response`, yardi-hl7 capture gate, yardi-hl7 dual ACK / persist AR branches (ALIS/FHIR only again)
- Modify: `tests/http/webhook.test.ts` — remove `POST /webhook/yardi/hl7` describe block; keep ALIS tests

- [ ] **Step 1: Write/adjust tests**

Remove Yardi HL7 HTTP tests. Optionally add:

```ts
it('does not expose yardi hl7 webhook route', async () => {
  const response = await request(app)
    .post('/webhook/yardi/hl7')
    .set('Authorization', authHeader)
    .set('Content-Type', 'text/plain')
    .send('MSH|...');
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Remove route, middleware, handler HL7 HTTP special-cases**

Keep `hl7Ack.ts` (unused is OK for now, or leave for future ProcessACK helpers — do not delete unless unused and lint forbids). Prefer keep `hl7Ack.ts`.

- [ ] **Step 3: Run**

```bash
npx jest tests/http/webhook.test.ts --runInBand
```

Expected: ALIS PASS; no HL7 webhook suite (or 404 test PASS)

- [ ] **Step 4: Commit**

```bash
git add src/http/routes.ts src/webhook/handler.ts tests/http/webhook.test.ts
git add -u src/http/middleware/parseYardiHl7Body.ts
git commit -m "refactor(yardi-hl7): remove push webhook in favor of broker poll"
```

---

### Task 7: Regression + ready checklist

- [ ] **Step 1: Run focused suites**

```bash
npx jest tests/integrations/yardi/yardiHl7BrokerXml.test.ts tests/integrations/yardi/yardiHl7BrokerClient.test.ts tests/integrations/yardi/yardiHl7PollCapture.test.ts tests/http/webhook.test.ts tests/integrations/ehr/yardiHl7AdtAdapter.test.ts tests/integrations/ehr/hl7Ack.test.ts --runInBand
```

Expected: all PASS

- [ ] **Step 2: Manual deploy checklist (document in commit message or leave for ops)**

1. Set `YARDI_HL7_MAILBOX_PASSWORD` (from Yardi email; never commit)
2. Confirm QA URLs (or prod)
3. `YARDI_HL7_POLL_ENABLED=true` on worker
4. Confirm egress IPs whitelisted with Yardi
5. Ask Yardi to queue test ADT → watch `/monitor` for `yardi-hl7`

- [ ] **Step 3: Commit any leftover fixes**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| GetMessage poll + XML/QBP | 2, 3, 5 |
| MSH.8.1 password from env | 1, 3 |
| ProcessACK after capture/duplicate | 2, 4 |
| Capture-only EventLog | 4 |
| Drain until empty + max cap | 4, 5 |
| Remove push webhook | 6 |
| QA default URLs / configurable | 1 |
| ALIS/FHIR unchanged | 5, 6 |
| Tests | 2–7 |

## Password note for implementers

Do **not** commit `3Y3watchLiV3!$`. Use local/deploy env only.
