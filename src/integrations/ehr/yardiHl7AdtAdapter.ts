import { z } from 'zod';

import type { EhrAdapter, FetchResidentBundleArgs, ResolveResidentIdArgs } from './adapter.js';
import type {
  CanonicalInboundEvent,
  CanonicalResidentBundle,
  CanonicalResidentDemographics,
  EhrLifecycleKind,
} from './types.js';

const YardiHl7WebhookSchema = z.object({
  CompanyKey: z.string(),
  CommunityId: z.number().nullable().optional(),
  EventType: z.string().optional(),
  EventMessageId: z.union([z.string(), z.number()]).transform(String),
  EventMessageDate: z.string(),
  Message: z.string(),
  NotificationData: z.record(z.unknown()).optional(),
});

type ParsedHl7Message = {
  triggerEvent: string;
  residentId?: number;
  patientFirstName?: string;
  patientLastName?: string;
  dateOfBirth?: string;
  roomNumber?: string;
  bed?: string;
  residentStatus?: string;
};

function parseField(segment: string, index: number): string | undefined {
  const fields = segment.split('|');
  return fields[index];
}

function parseComponent(field: string | undefined, index: number): string | undefined {
  if (!field) return undefined;
  const parts = field.split('^');
  const value = parts[index];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseHl7Date(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length >= 8) {
    const yyyy = value.slice(0, 4);
    const mm = value.slice(4, 6);
    const dd = value.slice(6, 8);
    return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  }
  return null;
}

function toLifecycle(triggerEvent: string): EhrLifecycleKind {
  const normalized = triggerEvent.toUpperCase();
  if (normalized === 'A05') return 'created';
  if (normalized === 'A01') return 'move_in';
  if (normalized === 'A03') return 'move_out';
  if (normalized === 'A21') return 'leave_start';
  if (normalized === 'A22') return 'leave_end';
  if (normalized === 'A08' || normalized === 'A02' || normalized === 'A60') return 'update';
  return 'unknown';
}

function parseHl7Message(message: string): ParsedHl7Message {
  const segments = message
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const evn = segments.find((line) => line.startsWith('EVN|'));
  const pid = segments.find((line) => line.startsWith('PID|'));
  const pv1 = segments.find((line) => line.startsWith('PV1|'));

  const triggerEvent =
    parseField(evn ?? '', 1) ??
    parseComponent(parseField(segments.find((line) => line.startsWith('MSH|')) ?? '', 8), 1) ??
    'UNKNOWN';

  const residentIdRaw = parseField(pid ?? '', 3);
  const residentId = residentIdRaw ? Number(parseComponent(residentIdRaw, 0) ?? residentIdRaw) : undefined;

  return {
    triggerEvent,
    residentId: Number.isFinite(residentId) ? residentId : undefined,
    patientLastName: parseComponent(parseField(pid ?? '', 5), 0),
    patientFirstName: parseComponent(parseField(pid ?? '', 5), 1),
    dateOfBirth: parseField(pid ?? '', 7),
    residentStatus: parseComponent(parseField(pv1 ?? '', 2), 1),
    roomNumber: parseComponent(parseField(pv1 ?? '', 3), 1),
    bed: parseComponent(parseField(pv1 ?? '', 3), 2),
  };
}

export class YardiHl7AdtAdapter implements EhrAdapter {
  readonly source = 'yardi-hl7' as const;

  parseInboundEvent(payload: unknown): CanonicalInboundEvent {
    const parsed = YardiHl7WebhookSchema.parse(payload);
    const hl7 = parseHl7Message(parsed.Message);
    const eventType = parsed.EventType ?? `hl7.adt.${hl7.triggerEvent.toLowerCase()}`;
    return {
      source: this.source,
      companyKey: parsed.CompanyKey,
      communityId: parsed.CommunityId ?? null,
      eventType,
      eventMessageId: parsed.EventMessageId,
      eventMessageDate: parsed.EventMessageDate,
      lifecycleKind: toLifecycle(hl7.triggerEvent),
      notificationData: {
        ...(parsed.NotificationData ?? {}),
        TriggerEvent: hl7.triggerEvent,
        ResidentId: hl7.residentId ?? null,
      },
      raw: {
        message: parsed.Message,
        parsed,
      },
    };
  }

  supportsEventType(_eventType: string): boolean {
    return true;
  }

  requiresResidentFetch(_eventType: string): boolean {
    return true;
  }

  resolveResidentId(args: ResolveResidentIdArgs): number {
    const raw = args.event.notificationData.ResidentId;
    const numeric =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim().length > 0
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(numeric)) {
      throw new Error('HL7 event is missing ResidentId in PID segment');
    }
    return numeric;
  }

  async fetchResidentBundle(args: FetchResidentBundleArgs): Promise<CanonicalResidentBundle> {
    const raw = args.event.raw as { message?: string } | undefined;
    const parsed = parseHl7Message(raw?.message ?? '');
    const demographics: CanonicalResidentDemographics = {
      externalResidentId: String(args.residentId),
      status: parsed.residentStatus ?? null,
      firstName: parsed.patientFirstName ?? null,
      lastName: parsed.patientLastName ?? null,
      dateOfBirth: parseHl7Date(parsed.dateOfBirth),
      roomNumber: parsed.roomNumber ?? null,
      bed: parsed.bed ?? null,
      room:
        parsed.roomNumber && parsed.bed
          ? `${parsed.roomNumber} ${parsed.bed}`
          : parsed.roomNumber ?? null,
      productType: null,
      classification: null,
      onPrem: null,
      onPremDate: null,
      offPrem: null,
      offPremDate: null,
      updatedAtUtc: args.event.eventMessageDate,
    };

    return {
      source: this.source,
      companyId: args.companyId,
      companyKey: args.companyKey,
      communityId: args.event.communityId,
      residentId: args.residentId,
      event: args.event,
      demographics,
      vendorPayload: {
        hl7: raw?.message ?? null,
        parsed,
      },
      raw: {
        hl7: raw?.message ?? null,
        parsed,
      },
    };
  }
}
