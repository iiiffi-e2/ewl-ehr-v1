import { env } from '../../config/env.js';
import { getConfiguredYardiFhirPollTargets } from './yardiFhirPollConfig.js';

export type YardiHl7PollTarget = {
  companyKey: string;
  communityId: number;
  facilityId: string;
};

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function normalizeRosterRaw(raw: string | undefined): string {
  if (!raw) {
    return '';
  }
  return stripWrappingQuotes(raw.replace(/^\uFEFF/, ''));
}

function parseCommunityId(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value.trim());
  }
  return NaN;
}

export function parseYardiHl7PollTargets(raw: string | undefined): YardiHl7PollTarget[] {
  const trimmed = normalizeRosterRaw(raw);
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('YARDI_HL7_POLL_TARGETS JSON must be an array');
    }
    return parsed.map(parsePollTargetRecord);
  }

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [companyKeyRaw, communityIdRaw, facilityIdRaw] = part.split(':');
      const companyKey = stripWrappingQuotes(companyKeyRaw ?? '');
      const communityIdTrimmed = stripWrappingQuotes(communityIdRaw ?? '');
      const facilityId = stripWrappingQuotes(facilityIdRaw ?? '');
      const communityId = Number(communityIdTrimmed);
      if (!companyKey || !communityIdTrimmed || !facilityId || !Number.isFinite(communityId)) {
        throw new Error(
          `Invalid YARDI_HL7_POLL_TARGETS entry '${part}'. Expected companyKey:communityId:facilityId`,
        );
      }
      return {
        companyKey,
        communityId,
        facilityId,
      };
    });
}

function parsePollTargetRecord(value: unknown): YardiHl7PollTarget {
  if (!value || typeof value !== 'object') {
    throw new Error('Each YARDI_HL7_POLL_TARGETS entry must be an object');
  }
  const record = value as Record<string, unknown>;
  const companyKey = typeof record.companyKey === 'string' ? record.companyKey.trim() : '';
  const facilityId = typeof record.facilityId === 'string' ? record.facilityId.trim() : '';
  const communityId = parseCommunityId(record.communityId);

  if (!companyKey || !facilityId || !Number.isFinite(communityId)) {
    throw new Error('Poll target requires companyKey, communityId, and facilityId');
  }

  return { companyKey, communityId, facilityId };
}

export function deriveYardiHl7PollTargetsFromFhir(
  fhirTargets: Array<{ companyKey: string; communityId: number }>,
  sendingFacility: string,
): YardiHl7PollTarget[] {
  const facilityId = sendingFacility.trim();
  if (!facilityId || fhirTargets.length !== 1) {
    return [];
  }
  const [target] = fhirTargets;
  return [
    {
      companyKey: target.companyKey,
      communityId: target.communityId,
      facilityId,
    },
  ];
}

export function getConfiguredYardiHl7PollTargets(): YardiHl7PollTarget[] {
  const explicit = parseYardiHl7PollTargets(env.YARDI_HL7_POLL_TARGETS);
  if (explicit.length > 0) {
    return explicit;
  }
  return deriveYardiHl7PollTargetsFromFhir(
    getConfiguredYardiFhirPollTargets(),
    env.YARDI_HL7_SENDING_FACILITY,
  );
}

export function resolveYardiHl7Facility(
  facilityId: string | null | undefined,
  targets: YardiHl7PollTarget[] = getConfiguredYardiHl7PollTargets(),
): YardiHl7PollTarget | null {
  const normalized = facilityId?.trim();
  if (!normalized) {
    return null;
  }

  const upper = normalized.toUpperCase();
  return targets.find((target) => target.facilityId.trim().toUpperCase() === upper) ?? null;
}
