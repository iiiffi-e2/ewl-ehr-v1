const upsertByFieldsMock = jest.fn();
const upsertPatientByPatientNumberMock = jest.fn();
const recordUnmatchedCuidMock = jest.fn();

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
  },
}));

jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../src/db/prisma.js', () => ({
  prisma: {},
}));

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  caspioRequestWithRetry: (operation: () => Promise<unknown>) => operation(),
  upsertByFields: (...args: unknown[]) => upsertByFieldsMock(...args),
  upsertPatientByPatientNumber: (...args: unknown[]) => upsertPatientByPatientNumberMock(...args),
}));

jest.mock('../../../src/domains/unmatchedCuid.js', () => ({
  recordUnmatchedCuid: (...args: unknown[]) => recordUnmatchedCuidMock(...args),
}));

import { pushYardiFhirCaspioRecords } from '../../../src/integrations/yardi/yardiFhirSync.js';

const context = {
  companyId: 10,
  externalResidentId: '418612',
  roomNumber: '141',
  firstName: 'Denise',
  lastName: 'Morgan',
  dateOfBirth: '2022-09-01T00:00:00.000Z',
  eventType: 'yardi.poll.sync',
  eventMessageId: 'yardi-poll-yourlife-113-p1',
};

function records(cuid: string) {
  return {
    tables: {
      patient: 'CarePatientTable_API',
      community: 'CommunityTable_API',
      service: 'Service_Table_API',
    },
    patientRecord: { PatientNumber: '418612', CUID: cuid, RoomNumber: '141' },
    communityRecord: { CommunityID: '113', CUID: cuid, RoomNumber: '141' },
    serviceRecord: { CUID: cuid, PatientNumber: '418612', ServiceType: 'Unassigned' },
    skipService: true,
  };
}

describe('pushYardiFhirCaspioRecords unmatched CUID', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upsertPatientByPatientNumberMock.mockResolvedValue({});
    upsertByFieldsMock.mockResolvedValue({});
    recordUnmatchedCuidMock.mockResolvedValue(undefined);
  });

  it('records the worklist after a synthetic patient write and skips the community insert', async () => {
    await pushYardiFhirCaspioRecords(records('COMM-113-141'), context);

    expect(upsertByFieldsMock).not.toHaveBeenCalled();
    expect(upsertPatientByPatientNumberMock).toHaveBeenCalled();
    expect(recordUnmatchedCuidMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 10,
        communityId: 113,
        source: 'yardi-fhir',
        syntheticCuid: 'COMM-113-141',
        eventType: 'yardi.poll.sync',
        eventMessageId: 'yardi-poll-yourlife-113-p1',
      }),
    );
    expect(recordUnmatchedCuidMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      upsertPatientByPatientNumberMock.mock.invocationCallOrder[0],
    );
  });

  it('does not record a row for a real CUID', async () => {
    await pushYardiFhirCaspioRecords(records('965'), context);
    expect(recordUnmatchedCuidMock).not.toHaveBeenCalled();
  });

  it('does not record a row when the patient write throws', async () => {
    upsertPatientByPatientNumberMock.mockRejectedValueOnce(new Error('caspio down'));
    await expect(pushYardiFhirCaspioRecords(records('COMM-113-141'), context)).rejects.toThrow(
      'caspio down',
    );
    expect(recordUnmatchedCuidMock).not.toHaveBeenCalled();
  });
});
