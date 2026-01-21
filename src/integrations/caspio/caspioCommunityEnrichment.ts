import { logger } from '../../config/logger.js';
import {
  findCommunityById,
  findCommunityByIdAndRoomNumber,
  type CommunityTableRecord,
} from './caspioClient.js';

export type CommunityEnrichment = {
  CommunityGroup?: string;
  Neighborhood?: string;
  SerialNumber?: string;
  CommunityName?: string;
  Address?: string;
};

function normalizeRoomNumber(value?: string | number | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getStringField(
  record: CommunityTableRecord | undefined,
  field: keyof CommunityTableRecord,
): string | undefined {
  if (!record) return undefined;
  const value = record[field];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export async function getCommunityEnrichment(
  communityId: number,
  roomNumber?: string | number | null,
): Promise<CommunityEnrichment> {
  const enrichment: CommunityEnrichment = {};

  const communityLookup = await findCommunityById(communityId);
  if (communityLookup.found) {
    const record = communityLookup.record;
    enrichment.CommunityGroup = getStringField(record, 'CommunityGroup');
    enrichment.CommunityName = getStringField(record, 'CommunityName');
    enrichment.Address = getStringField(record, 'Address');
  }

  const normalizedRoom = normalizeRoomNumber(roomNumber);
  if (normalizedRoom) {
    const roomLookup = await findCommunityByIdAndRoomNumber(communityId, normalizedRoom);
    if (roomLookup.found) {
      const record = roomLookup.record;
      enrichment.Neighborhood = getStringField(record, 'Neighborhood');
      enrichment.SerialNumber = getStringField(record, 'SerialNumber');
      if (!enrichment.CommunityGroup) {
        enrichment.CommunityGroup = getStringField(record, 'CommunityGroup');
      }
    }
  }

  logger.debug(
    {
      communityId,
      hasRoomNumber: Boolean(normalizedRoom),
      enrichedKeys: Object.keys(enrichment),
    },
    'caspio_community_enrichment_complete',
  );

  return enrichment;
}
