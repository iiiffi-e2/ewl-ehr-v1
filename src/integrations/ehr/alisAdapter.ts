import { parseISO } from 'date-fns';

import {
  createAlisClient,
  fetchAllResidentData,
  resolveAlisCredentials,
  type AlisLeave,
  type AlisResidentBasicInfo,
  type AlisResidentDetail,
} from '../alisClient.js';
import { normalizeResident } from '../mappers.js';
import {
  AlisEventSchema,
  isSupportedEventType,
  requiresLeaveFetch,
  requiresResidentFetch,
  type AlisEvent,
} from '../../webhook/schemas.js';
import type { EhrAdapter, FetchResidentBundleArgs, ResolveResidentIdArgs } from './adapter.js';
import type {
  CanonicalInboundEvent,
  CanonicalResidentBundle,
  CanonicalResidentDemographics,
  EhrLifecycleKind,
} from './types.js';

function lifecycleFromAlisEventType(eventType: string): EhrLifecycleKind {
  if (eventType === 'residents.created') return 'created';
  if (eventType === 'residents.move_in') return 'move_in';
  if (eventType === 'residents.move_out') return 'move_out';
  if (eventType === 'residents.leave_start') return 'leave_start';
  if (eventType === 'residents.leave_end') return 'leave_end';
  if (eventType === 'residents.leave_cancelled') return 'leave_cancelled';
  if (
    eventType === 'resident.contact.created' ||
    eventType === 'resident.contact.updated' ||
    eventType === 'resident.contact.deleted'
  ) {
    return 'contact';
  }
  if (eventType.startsWith('resident.') || eventType.startsWith('residents.')) {
    return 'update';
  }
  return 'unknown';
}

function extractNumeric(payload: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function parseDateString(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toCanonicalDemographics(
  residentId: number,
  detail: AlisResidentDetail,
  basicInfo: AlisResidentBasicInfo,
): CanonicalResidentDemographics {
  const normalized = normalizeResident({ detail, basicInfo });
  return {
    externalResidentId: String(residentId),
    status: normalized.status,
    firstName: normalized.firstName ?? null,
    lastName: normalized.lastName ?? null,
    dateOfBirth: normalized.dateOfBirth?.toISOString() ?? null,
    roomNumber: normalized.roomNumber ?? null,
    bed: normalized.bed ?? null,
    room: normalized.room ?? null,
    productType: normalized.productType ?? null,
    classification: normalized.classification ?? null,
    onPrem: normalized.onPrem ?? null,
    onPremDate: normalized.onPremDate?.toISOString() ?? null,
    offPrem: normalized.offPrem ?? null,
    offPremDate: normalized.offPremDate?.toISOString() ?? null,
    updatedAtUtc: normalized.updatedAtUtc?.toISOString() ?? null,
  };
}

export function canonicalToAlisEvent(event: CanonicalInboundEvent): AlisEvent {
  return {
    CompanyKey: event.companyKey,
    CommunityId: event.communityId,
    EventType: event.eventType,
    EventMessageId: event.eventMessageId,
    EventMessageDate: event.eventMessageDate,
    NotificationData: event.notificationData,
  };
}

export class AlisAdapter implements EhrAdapter {
  readonly source = 'alis' as const;

  parseInboundEvent(payload: unknown): CanonicalInboundEvent {
    const parsed = AlisEventSchema.parse(payload);
    return {
      source: this.source,
      companyKey: parsed.CompanyKey,
      communityId: parsed.CommunityId ?? null,
      eventType: parsed.EventType,
      eventMessageId: parsed.EventMessageId,
      eventMessageDate: parsed.EventMessageDate,
      lifecycleKind: lifecycleFromAlisEventType(parsed.EventType),
      notificationData: parsed.NotificationData ?? {},
      raw: parsed,
    };
  }

  supportsEventType(eventType: string): boolean {
    return isSupportedEventType(eventType);
  }

  requiresResidentFetch(eventType: string): boolean {
    return requiresResidentFetch(eventType);
  }

  resolveResidentId(args: ResolveResidentIdArgs): number {
    const residentId = extractNumeric(args.event.notificationData, ['ResidentId', 'residentId']);
    if (!residentId) {
      throw new Error('ResidentId missing from NotificationData');
    }
    return residentId;
  }

  async fetchResidentBundle(args: FetchResidentBundleArgs): Promise<CanonicalResidentBundle> {
    const residentId =
      typeof args.residentId === 'number' ? args.residentId : Number(args.residentId);
    if (!Number.isFinite(residentId)) {
      throw new Error('ALIS residentId must be numeric');
    }

    const credentials = await resolveAlisCredentials(args.companyId, args.companyKey);
    const alisClient = createAlisClient(credentials);
    const [residentDetail, residentBasicInfo] = await Promise.all([
      alisClient.getResident(residentId),
      alisClient.getResidentBasicInfo(residentId),
    ]);

    let leaveData: AlisLeave | null = null;
    if (requiresLeaveFetch(args.event.eventType)) {
      const leaveId = extractNumeric(args.event.notificationData, ['LeaveId', 'leaveId']);
      if (leaveId) {
        leaveData = await alisClient.getLeave(leaveId);
      } else {
        const leaves = await alisClient.getResidentLeaves(residentId);
        leaveData = leaves.find((leave) => {
          const id = extractNumeric(leave as Record<string, unknown>, ['LeaveId', 'leaveId']);
          return Boolean(id);
        }) ?? null;
      }
    }

    const fullResidentData = await fetchAllResidentData(
      credentials,
      residentId,
      args.event.communityId,
    );

    return {
      source: this.source,
      companyKey: args.companyKey,
      companyId: args.companyId,
      communityId: args.event.communityId,
      residentId,
      event: args.event,
      demographics: toCanonicalDemographics(residentId, residentDetail, residentBasicInfo),
      vendorPayload: {
        residentDetail,
        residentBasicInfo,
        leaveData,
        fullResidentData,
      },
      raw: {
        residentDetail,
        residentBasicInfo,
        leaveData,
      },
    };
  }
}

export function getAlisResidentEventTimestamp(event: CanonicalInboundEvent): string {
  const parsed = parseDateString(event.eventMessageDate);
  return parsed ?? new Date().toISOString();
}
