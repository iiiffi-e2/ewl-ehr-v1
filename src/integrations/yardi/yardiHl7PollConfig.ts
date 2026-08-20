import { env } from '../../config/env.js';

export type YardiHl7PollTarget = {
  companyKey: string;
  communityId: number;
  facilityId: string;
};

export function parseYardiHl7PollTargets(raw: string | undefined): YardiHl7PollTarget[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const trimmed = raw.trim();
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
      const [companyKey, communityIdRaw, facilityId] = part.split(':');
      const communityId = Number(communityIdRaw);
      if (!companyKey || !facilityId || !Number.isFinite(communityId)) {
        throw new Error(
          `Invalid YARDI_HL7_POLL_TARGETS entry '${part}'. Expected companyKey:communityId:facilityId`,
        );
      }
      return {
        companyKey: companyKey.trim(),
        communityId,
        facilityId: facilityId.trim(),
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
  const communityId =
    typeof record.communityId === 'number'
      ? record.communityId
      : typeof record.communityId === 'string'
        ? Number(record.communityId)
        : NaN;

  if (!companyKey || !facilityId || !Number.isFinite(communityId)) {
    throw new Error('Poll target requires companyKey, communityId, and facilityId');
  }

  return { companyKey, communityId, facilityId };
}

export function getConfiguredYardiHl7PollTargets(): YardiHl7PollTarget[] {
  return parseYardiHl7PollTargets(env.YARDI_HL7_POLL_TARGETS);
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
