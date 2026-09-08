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

    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(113, '218', 'YourLife Pensacola');
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

  it('looks up CUID by community id and room when community name is unknown', async () => {
    findCommunityByIdMock.mockResolvedValueOnce({ found: false });
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({
      found: true,
      record: {
        CommunityID: 237,
        RoomNumber: '200',
        CUID: '3002',
        CommunityName: 'Yardi Test',
      },
    });

    const enrichment = await getCommunityEnrichment(237, '200');

    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(237, '200', undefined);
    expect(enrichment.CUID).toBe('3002');
    expect(enrichment.CommunityName).toBe('Yardi Test');
  });
});
