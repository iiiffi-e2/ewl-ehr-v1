import { env } from '../../config/env.js';

import type { YardiFhirPollTarget } from './yardiFhirTypes.js';

export function parseYardiFhirPollTargets(raw: string | undefined): YardiFhirPollTarget[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('YARDI_FHIR_POLL_TARGETS JSON must be an array');
    }
    return parsed.map(parsePollTargetRecord);
  }

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [companyKey, communityIdRaw, organizationId] = part.split(':');
      const communityId = Number(communityIdRaw);
      if (!companyKey || !organizationId || !Number.isFinite(communityId)) {
        throw new Error(
          `Invalid YARDI_FHIR_POLL_TARGETS entry '${part}'. Expected companyKey:communityId:organizationId`,
        );
      }
      return {
        companyKey: companyKey.trim(),
        communityId,
        organizationId: organizationId.trim(),
      };
    });
}

function parsePollTargetRecord(value: unknown): YardiFhirPollTarget {
  if (!value || typeof value !== 'object') {
    throw new Error('Each YARDI_FHIR_POLL_TARGETS entry must be an object');
  }
  const record = value as Record<string, unknown>;
  const companyKey = typeof record.companyKey === 'string' ? record.companyKey.trim() : '';
  const organizationId =
    typeof record.organizationId === 'string' ? record.organizationId.trim() : '';
  const communityId =
    typeof record.communityId === 'number'
      ? record.communityId
      : typeof record.communityId === 'string'
        ? Number(record.communityId)
        : NaN;

  if (!companyKey || !organizationId || !Number.isFinite(communityId)) {
    throw new Error('Poll target requires companyKey, communityId, and organizationId');
  }

  return { companyKey, communityId, organizationId };
}

export function getConfiguredYardiFhirPollTargets(): YardiFhirPollTarget[] {
  return parseYardiFhirPollTargets(env.YARDI_FHIR_POLL_TARGETS);
}

export function getYardiFhirPollCursorKey(target: YardiFhirPollTarget): string {
  return `yardi-fhir-sync:${target.companyKey}:${target.communityId}:lastPollAt`;
}
