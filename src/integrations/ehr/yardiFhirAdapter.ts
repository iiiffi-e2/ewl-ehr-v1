import { z } from 'zod';

import type { EhrAdapter, FetchResidentBundleArgs, ResolveResidentIdArgs } from './adapter.js';
import type {
  CanonicalInboundEvent,
  CanonicalResidentBundle,
  EhrLifecycleKind,
} from './types.js';
import { YardiFhirClient } from '../yardi/yardiFhirClient.js';
import { mapYardiFhirBundleToDemographics } from '../yardi/yardiFhirDemographics.js';

const YardiFhirWebhookSchema = z.object({
  CompanyKey: z.string(),
  CommunityId: z.number().nullable().optional(),
  EventType: z.string(),
  EventMessageId: z.union([z.string(), z.number()]).transform(String),
  EventMessageDate: z.string(),
  NotificationData: z.record(z.unknown()).optional(),
});

function getLifecycle(eventType: string): EhrLifecycleKind {
  const normalized = eventType.toLowerCase();
  if (normalized.includes('move_in') || normalized.includes('admit') || normalized.includes('a01')) {
    return 'move_in';
  }
  if (normalized.includes('move_out') || normalized.includes('discharge') || normalized.includes('a03')) {
    return 'move_out';
  }
  if (normalized.includes('leave_start') || normalized.includes('a21')) return 'leave_start';
  if (normalized.includes('leave_end') || normalized.includes('a22')) return 'leave_end';
  if (normalized.includes('created')) return 'created';
  if (normalized.includes('contact')) return 'contact';
  if (normalized.includes('update') || normalized.includes('a08') || normalized.includes('a02')) {
    return 'update';
  }
  return 'unknown';
}

function extractPatientId(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  for (const key of ['PatientId', 'patientId', 'ResidentId', 'residentId']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function extractText(
  payload: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export class YardiFhirAdapter implements EhrAdapter {
  readonly source = 'yardi-fhir' as const;

  parseInboundEvent(payload: unknown): CanonicalInboundEvent {
    const parsed = YardiFhirWebhookSchema.parse(payload);
    return {
      source: this.source,
      companyKey: parsed.CompanyKey,
      communityId: parsed.CommunityId ?? null,
      eventType: parsed.EventType,
      eventMessageId: parsed.EventMessageId,
      eventMessageDate: parsed.EventMessageDate,
      lifecycleKind: getLifecycle(parsed.EventType),
      notificationData: parsed.NotificationData ?? {},
      raw: payload,
    };
  }

  supportsEventType(_eventType: string): boolean {
    return true;
  }

  requiresResidentFetch(_eventType: string): boolean {
    return true;
  }

  resolvePatientIdentity(args: ResolveResidentIdArgs) {
    const externalPatientId = extractPatientId(args.event.notificationData);
    if (!externalPatientId) {
      throw new Error('ResidentId/PatientId missing from NotificationData');
    }
    const numericResidentId = Number(externalPatientId);
    return {
      externalPatientId,
      numericResidentId: Number.isFinite(numericResidentId) ? numericResidentId : null,
    };
  }

  resolveResidentId(args: ResolveResidentIdArgs): string {
    return this.resolvePatientIdentity(args).externalPatientId;
  }

  async fetchResidentBundle(args: FetchResidentBundleArgs): Promise<CanonicalResidentBundle> {
    YardiFhirClient.assertConfigured();
    const patientId = args.patientId ?? String(args.residentId);
    const client = YardiFhirClient.createConfigured();
    const bundle = await client.fetchPatientBundle(patientId);
    const demographics = mapYardiFhirBundleToDemographics(bundle);
    const room = extractText(args.event.notificationData, ['RoomNumber', 'roomNumber', 'AssignedRoom']);
    if (room) {
      demographics.roomNumber = room;
      demographics.room = room;
    }

    return {
      source: this.source,
      companyId: args.companyId,
      companyKey: args.companyKey,
      communityId: args.event.communityId,
      residentId: patientId,
      event: args.event,
      demographics,
      vendorPayload: bundle,
      raw: bundle,
    };
  }
}
