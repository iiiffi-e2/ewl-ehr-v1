import { z } from 'zod';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';
import type { EhrAdapter, FetchResidentBundleArgs, ResolveResidentIdArgs } from './adapter.js';
import type {
  CanonicalInboundEvent,
  CanonicalResidentBundle,
  CanonicalResidentDemographics,
  EhrLifecycleKind,
} from './types.js';

const YardiFhirWebhookSchema = z.object({
  CompanyKey: z.string(),
  CommunityId: z.number().nullable().optional(),
  EventType: z.string(),
  EventMessageId: z.union([z.string(), z.number()]).transform(String),
  EventMessageDate: z.string(),
  NotificationData: z.record(z.unknown()).optional(),
});

type FhirBundleEntry = {
  resource?: Record<string, unknown>;
};

type FhirBundle = {
  resourceType?: string;
  entry?: FhirBundleEntry[];
};

type FhirPatient = Record<string, unknown>;

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

function pickPreferredName(patient: FhirPatient | null): { firstName?: string; lastName?: string } {
  if (!patient) return {};
  const names = Array.isArray(patient.name) ? (patient.name as Array<Record<string, unknown>>) : [];
  const preferred = names[0];
  if (!preferred) return {};
  const given = Array.isArray(preferred.given) ? preferred.given : [];
  const firstName =
    given.length > 0 && typeof given[0] === 'string' ? (given[0] as string).trim() : undefined;
  const family =
    typeof preferred.family === 'string' && preferred.family.trim().length > 0
      ? preferred.family.trim()
      : undefined;
  return { firstName, lastName: family };
}

function patientToDemographics(patient: FhirPatient | null, residentId: number): CanonicalResidentDemographics {
  const names = pickPreferredName(patient);
  return {
    externalResidentId: String(residentId),
    status: typeof patient?.active === 'boolean' ? (patient.active ? 'active' : 'inactive') : null,
    firstName: names.firstName ?? null,
    lastName: names.lastName ?? null,
    dateOfBirth:
      typeof patient?.birthDate === 'string' && patient.birthDate.length > 0
        ? `${patient.birthDate}T00:00:00.000Z`
        : null,
    roomNumber: null,
    bed: null,
    room: null,
    productType: null,
    classification: null,
    onPrem: null,
    onPremDate: null,
    offPrem: null,
    offPremDate: null,
    updatedAtUtc: null,
  };
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

  resolveResidentId(args: ResolveResidentIdArgs): number {
    const residentId = extractNumeric(args.event.notificationData, [
      'ResidentId',
      'residentId',
      'PatientId',
      'patientId',
    ]);
    if (!residentId) {
      throw new Error('ResidentId/PatientId missing from NotificationData');
    }
    return residentId;
  }

  async fetchResidentBundle(args: FetchResidentBundleArgs): Promise<CanonicalResidentBundle> {
    if (!env.YARDI_FHIR_TOKEN_URL || !env.YARDI_FHIR_API_BASE_URL) {
      throw new Error('Yardi FHIR is not configured in environment');
    }

    const tokenHttp = createHttpClient({
      baseURL: env.YARDI_FHIR_TOKEN_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth:
        env.YARDI_FHIR_CLIENT_ID && env.YARDI_FHIR_CLIENT_SECRET
          ? {
              username: env.YARDI_FHIR_CLIENT_ID,
              password: env.YARDI_FHIR_CLIENT_SECRET,
            }
          : undefined,
    });

    const tokenResponse = await tokenHttp.post('', new URLSearchParams({
      grant_type: 'client_credentials',
      scope: env.YARDI_FHIR_SCOPE,
    }).toString());
    const token = (tokenResponse.data as { access_token?: string }).access_token;
    if (!token) {
      throw new Error('Yardi FHIR token response missing access_token');
    }

    const fhirHttp = createHttpClient({
      baseURL: env.YARDI_FHIR_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json',
      },
    });

    let patient: FhirPatient | null = null;
    try {
      const patientResponse = await fhirHttp.get<FhirPatient>(`/Patient/${args.residentId}`);
      patient = patientResponse.data;
    } catch {
      const searchResponse = await fhirHttp.get<FhirBundle>(`/Patient?_id=${args.residentId}&_count=1`);
      patient = (searchResponse.data.entry?.[0]?.resource ?? null) as FhirPatient | null;
    }

    const encounterSearch = await fhirHttp.get<FhirBundle>(
      `/Encounter?patient=Patient/${args.residentId}&_count=1&_sort=-date`,
    );

    const demographics = patientToDemographics(patient, args.residentId);
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
      residentId: args.residentId,
      event: args.event,
      demographics,
      vendorPayload: {
        tokenType: 'Bearer',
        patient,
        encounterBundle: encounterSearch.data,
      },
      raw: {
        patient,
        encounterBundle: encounterSearch.data,
      },
    };
  }
}
