const findUniqueMock = jest.fn();
const createMock = jest.fn();
const updateMock = jest.fn();
const findManyMock = jest.fn();
const recordEventIssueMock = jest.fn();

jest.mock('../../src/db/prisma.js', () => ({
  prisma: {
    unmatchedCuid: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

jest.mock('../../src/domains/eventIssues.js', () => ({
  recordEventIssue: (...args: unknown[]) => recordEventIssueMock(...args),
  errorToIssueDetails: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import {
  listUnmatchedCuids,
  recordUnmatchedCuid,
  resolveUnmatchedCuid,
  UnmatchedCuidQueryError,
} from '../../src/domains/unmatchedCuid.js';

const input = {
  companyId: 10,
  communityId: 113,
  externalResidentId: '418612',
  roomNumber: ' 141 ',
  source: 'yardi-hl7' as const,
  firstName: 'Denise',
  lastName: 'Morgan',
  dateOfBirth: '2022-09-01T00:00:00.000Z',
  syntheticCuid: 'COMM-113-141',
  eventType: 'hl7.adt.a01',
  eventMessageId: 'yardi-hl7-event-1',
};

describe('recordUnmatchedCuid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 1 });
    updateMock.mockResolvedValue({ id: 1 });
  });

  it('inserts one open row with a trimmed room', async () => {
    await recordUnmatchedCuid(input);

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 10,
        communityId: 113,
        externalResidentId: '418612',
        roomNumber: '141',
        source: 'yardi-hl7',
        firstName: 'Denise',
        lastName: 'Morgan',
        syntheticCuid: 'COMM-113-141',
        status: 'open',
        lastEventType: 'hl7.adt.a01',
        lastEventMessageId: 'yardi-hl7-event-1',
        resolvedAt: null,
      }),
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('updates the same key and reopens a resolved row without changing firstSeenAt', async () => {
    findUniqueMock.mockResolvedValue({
      id: 7,
      status: 'resolved',
      firstName: 'Denise',
      lastName: 'Morgan',
    });

    await recordUnmatchedCuid({
      ...input,
      firstName: ' ',
      eventMessageId: 'yardi-hl7-event-2',
    });

    expect(createMock).not.toHaveBeenCalled();
    const data = updateMock.mock.calls[0][0].data;
    expect(data.status).toBe('open');
    expect(data.resolvedAt).toBeNull();
    expect(data.lastEventMessageId).toBe('yardi-hl7-event-2');
    expect(data.firstSeenAt).toBeUndefined();
    expect(data.firstName).toBeUndefined();
  });

  it('stores an empty room string when the room is blank', async () => {
    await recordUnmatchedCuid({ ...input, roomNumber: '   ' });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ roomNumber: '' }),
    });
  });

  it('records an issue and skips prisma when the patient number is blank', async () => {
    await recordUnmatchedCuid({ ...input, externalResidentId: '  ' });

    expect(createMock).not.toHaveBeenCalled();
    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'unmatched_cuid_record_failed',
        companyId: 10,
        source: 'yardi-hl7',
        eventMessageId: 'yardi-hl7-event-1',
      }),
    );
  });

  it('swallows a prisma error and records unmatched_cuid_record_failed', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'));

    await expect(recordUnmatchedCuid(input)).resolves.toBeUndefined();

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'unmatched_cuid_record_failed' }),
    );
  });
});

describe('listUnmatchedCuids', () => {
  it('defaults to open rows ordered by lastSeenAt desc', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await listUnmatchedCuids({});
    expect(findManyMock).toHaveBeenCalledWith({
      where: { status: 'open' },
      orderBy: { lastSeenAt: 'desc' },
    });
  });

  it('filters by community and status', async () => {
    findManyMock.mockResolvedValueOnce([]);
    await listUnmatchedCuids({ status: 'all', communityId: 113 });
    expect(findManyMock).toHaveBeenCalledWith({
      where: { communityId: 113 },
      orderBy: { lastSeenAt: 'desc' },
    });
  });

  it('rejects an unknown status', async () => {
    await expect(
      listUnmatchedCuids({ status: 'nope' as 'open' }),
    ).rejects.toBeInstanceOf(UnmatchedCuidQueryError);
  });
});

describe('resolveUnmatchedCuid', () => {
  it('returns null when the id is missing', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(resolveUnmatchedCuid(4)).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns a resolved row unchanged', async () => {
    const row = { id: 4, status: 'resolved', resolvedAt: new Date('2026-11-18T00:00:00.000Z') };
    findUniqueMock.mockResolvedValueOnce(row);
    await expect(resolveUnmatchedCuid(4)).resolves.toBe(row);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('sets status and resolvedAt', async () => {
    findUniqueMock.mockResolvedValueOnce({ id: 4, status: 'open' });
    updateMock.mockResolvedValueOnce({ id: 4, status: 'resolved' });
    await resolveUnmatchedCuid(4);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { status: 'resolved', resolvedAt: expect.any(Date) },
    });
  });
});