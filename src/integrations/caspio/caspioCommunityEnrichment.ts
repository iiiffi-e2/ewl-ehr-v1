import { logger } from '../../config/logger.js';
import {
  findCommunityById,
  findCommunityByIdAndRoomNumber,
  type CommunityTableRecord,
} from './caspioClient.js';

export type CommunityEnrichment = {
  CUID?: string;
  CommunityID?: string;
  CommunityGroup?: string;
  Neighborhood?: string;
  SerialNumber?: string;
  CommunityName?: string;
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Sector?: string;
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
  const normalizedRoom = normalizeRoomNumber(roomNumber);

  const communityLookup = await findCommunityById(communityId);
  if (communityLookup.found) {
    const record = communityLookup.record;
    if (!normalizedRoom) {
      enrichment.CUID = getStringField(record, 'CUID');
    }
    enrichment.CommunityID = getStringField(record, 'CommunityID');
    enrichment.CommunityGroup = getStringField(record, 'CommunityGroup');
    enrichment.CommunityName = getStringField(record, 'CommunityName');
    enrichment.Address = getStringField(record, 'Address');
    enrichment.City = getStringField(record, 'City');
    enrichment.State = getStringField(record, 'State');
    enrichment.Zip = getStringField(record, 'Zip');
    enrichment.Sector = getStringField(record, 'Sector');
  }

  if (normalizedRoom) {
    const roomLookup = await findCommunityByIdAndRoomNumber(communityId, normalizedRoom);
    if (roomLookup.found) {
      const record = roomLookup.record;
      // Room-level match is the most specific source for patient/service routing.
      // CUID is unique per (community, room): distinct rooms must not share one CUID.
      // Prefer CUID and CommunityName from this row when present.
      const roomLevelCuid = getStringField(record, 'CUID');
      const roomLevelCommunityName = getStringField(record, 'CommunityName');
      if (roomLevelCuid) {
        enrichment.CUID = roomLevelCuid;
      }
      if (roomLevelCommunityName) {
        enrichment.CommunityName = roomLevelCommunityName;
      }
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
