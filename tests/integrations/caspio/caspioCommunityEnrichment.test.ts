const findCommunityByIdMock = jest.fn();
const findCommunityByIdAndRoomNumberMock = jest.fn();

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  findCommunityById: findCommunityByIdMock,
  findCommunityByIdAndRoomNumber: findCommunityByIdAndRoomNumberMock,
}));

jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { getCommunityEnrichment } from '../../../src/integrations/caspio/caspioCommunityEnrichment.js';

describe('caspioCommunityEnrichment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findCommunityByIdMock.mockResolvedValue({
      found: true,
      record: {
        CommunityID: 113,
        CUID: 'community-default-cuid',
        CommunityName: 'YourLife Pensacola',
      },
    });
  });

  it('does not use community-only CUID when room-specific lookup fails', async () => {
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({ found: false });

    const enrichment = await getCommunityEnrichment(113, '218');

    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(113, '218');
    expect(enrichment).toEqual(
      expect.objectContaining({
        CommunityName: 'YourLife Pensacola',
      }),
    );
    expect(enrichment.CUID).toBeUndefined();
  });

  it('keeps community-only CUID when no room is provided', async () => {
    const enrichment = await getCommunityEnrichment(113);

    expect(findCommunityByIdAndRoomNumberMock).not.toHaveBeenCalled();
    expect(enrichment.CUID).toBe('community-default-cuid');
  });
});
