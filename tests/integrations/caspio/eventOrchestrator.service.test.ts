const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const findCommunityByIdAndRoomNumberMock = jest.fn();
const findActiveOrLatestServiceRowMock = jest.fn();
const findOpenOffPremEpisodeMock = jest.fn();
const upsertByFieldsMock = jest.fn();
const upsertOffPremEpisodeByEpisodeIdMock = jest.fn();
const updateRecordByIdMock = jest.fn();
const getCommunityEnrichmentMock = jest.fn();
const fetchAllResidentDataMock = jest.fn();
const resolveAlisCredentialsMock = jest.fn();
const recordEventIssueMock = jest.fn();

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  findRecordByFields: findRecordByFieldsMock,
  findByPatientNumber: findByPatientNumberMock,
  findCommunityByIdAndRoomNumber: findCommunityByIdAndRoomNumberMock,
  findActiveOrLatestServiceRow: findActiveOrLatestServiceRowMock,
  findOpenOffPremEpisode: findOpenOffPremEpisodeMock,
  upsertByFields: upsertByFieldsMock,
  upsertOffPremEpisodeByEpisodeId: upsertOffPremEpisodeByEpisodeIdMock,
  updateRecordById: updateRecordByIdMock,
}));

jest.mock('../../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: getCommunityEnrichmentMock,
}));

jest.mock('../../../src/integrations/alisClient.js', () => ({
  fetchAllResidentData: fetchAllResidentDataMock,
  resolveAlisCredentials: resolveAlisCredentialsMock,
}));

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    CASPIO_OFF_PREM_HISTORY_TABLE_NAME: 'PatientOffPremHistory_API',
  },
}));

jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/domains/eventIssues.js', () => ({
  errorToIssueDetails: jest.fn((error: unknown) => error),
  recordEventIssue: recordEventIssueMock,
}));

import { handleAlisEvent } from '../../../src/integrations/caspio/eventOrchestrator.js';

describe('eventOrchestrator service-table scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAlisCredentialsMock.mockResolvedValue({ username: 'u', password: 'p' });
    fetchAllResidentDataMock.mockReset();
    fetchAllResidentDataMock.mockResolvedValue({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    getCommunityEnrichmentMock.mockResolvedValue({
      CUID: '259',
      CommunityName: 'Test Community',
    });
    findCommunityByIdAndRoomNumberMock.mockResolvedValue({
      found: true,
      record: { CUID: '259', CommunityName: 'Test Community', RoomNumber: '101' },
    });
    findActiveOrLatestServiceRowMock.mockResolvedValue({
      found: true,
      id: 'svc-1',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });
    upsertByFieldsMock.mockResolvedValue({ action: 'update', id: 'id-1' });
    findRecordByFieldsMock.mockResolvedValue({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '70508', CUID: '259' },
    });
    findOpenOffPremEpisodeMock.mockResolvedValue({ found: false });
    upsertOffPremEpisodeByEpisodeIdMock.mockResolvedValue({ action: 'insert', id: 'ep-1' });
  });

  it('move_in creates service row with Move_in_Date start', async () => {
    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_in',
      EventMessageId: 'evt-move-in',
      EventMessageDate: '2026-01-15T10:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: '259' },
        { field: 'StartDate', value: '01/10/2026 00:00:00' },
        { field: 'PatientNumber', value: '70508' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ]),
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        Room: '101',
        CommunityName: 'Test Community',
        ServiceType: 'Assisted Living',
        StartDate: '01/10/2026 00:00:00',
      }),
    );
  });

  it('move_in uses Classification from basicInfo when resident classification is missing', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        ProductType: '',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {
        Classification: 'Assisted Living',
      },
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_in',
      EventMessageId: 'evt-move-in-basicinfo-classification',
      EventMessageDate: '2026-01-15T10:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.any(Array),
      expect.objectContaining({
        PatientNumber: '70508',
        ServiceType: 'Assisted Living',
      }),
    );
  });

  it('move_in uses event room number fallback for ApartmentNumber', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_in',
      EventMessageId: 'evt-move-in-room-fallback',
      EventMessageDate: '2026-01-15T10:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomsAssigned: [{ RoomNumber: '49' }],
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      expect.any(Array),
      expect.objectContaining({
        PatientNumber: '70508',
        ApartmentNumber: '49',
      }),
    );
  });

  it('move_out closes end date on latest service row', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-21T14:00:00Z'));
    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_out',
      EventMessageId: 'evt-move-out',
      EventMessageDate: '2026-01-20T10:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
        MoveOutDate: '2026-01-20',
      },
    };

    try {
      await handleAlisEvent(event, 10, 'appstoresandbox');

      expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'svc-1', {
        EndDate: '01/21/2026 14:00:00',
      });
      expect(upsertByFieldsMock).toHaveBeenCalledWith(
        'Service_Table_API',
        [
          { field: 'CUID', value: '259' },
          { field: 'StartDate', value: '01/21/2026 14:00:00' },
          { field: 'PatientNumber', value: '70508' },
          { field: 'ServiceType', value: 'Vacant' },
        ],
        expect.objectContaining({
          CUID: '259',
          ServiceType: 'Vacant',
          StartDate: '01/21/2026 14:00:00',
          PatientNumber: '70508',
        }),
      );
      const vacantPayload = upsertByFieldsMock.mock.calls.find((call) => {
        if (call[0] !== 'Service_Table_API') return false;
        const row = call[2] as Record<string, unknown>;
        if (row?.ServiceType !== 'Vacant') return false;
        const pn = row.PatientNumber;
        return pn === undefined || pn === null || String(pn).trim() === '';
      })?.[2] as Record<string, unknown> | undefined;
      expect(vacantPayload).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('classification change closes old row and creates new row at event date', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-old',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-service-change',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
        Classification: 'Memory Care',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'svc-old', {
      EndDate: '01/22/2026 12:00:00',
    });
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: '259' },
        { field: 'StartDate', value: '01/22/2026 12:00:00' },
        { field: 'PatientNumber', value: '70508' },
        { field: 'ServiceType', value: 'Memory Care' },
      ]),
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        Room: '101',
        CommunityName: 'Test Community',
        ServiceType: 'Memory Care',
        StartDate: '01/22/2026 12:00:00',
      }),
    );
  });

  it('basic_info_updated skips service table when classification matches active row', async () => {
    const residentPayload = {
      resident: { Classification: 'Assisted Living', ProductType: 'Assisted Living' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    };
    fetchAllResidentDataMock
      .mockResolvedValueOnce({ ...residentPayload })
      .mockResolvedValueOnce({ ...residentPayload });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-same',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-no-svc-change-active',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    const serviceWrites = upsertByFieldsMock.mock.calls.filter((c) => c[0] === 'Service_Table_API');
    expect(serviceWrites).toHaveLength(0);
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.any(Object),
    );
  });

  it('basic_info_updated creates service row when latest matching CUID row is closed with same service type', async () => {
    const residentPayload = {
      resident: { Classification: 'Assisted Living', ProductType: 'Assisted Living' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    };
    fetchAllResidentDataMock
      .mockResolvedValueOnce({ ...residentPayload })
      .mockResolvedValueOnce({ ...residentPayload });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-closed',
      record: {
        ServiceType: 'Assisted Living',
        StartDate: '2026-01-01',
        EndDate: '01/15/2026 12:00:00',
      },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-no-svc-change-closed',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    const serviceWrites = upsertByFieldsMock.mock.calls.filter((c) => c[0] === 'Service_Table_API');
    expect(serviceWrites).toHaveLength(1);
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: '259' },
        { field: 'PatientNumber', value: '70508' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ]),
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        ServiceType: 'Assisted Living',
        StartDate: '01/22/2026 12:00:00',
      }),
    );
  });

  it('basic_info_updated creates service row when latest matching CUID row is closed with different service type', async () => {
    const residentPayload = {
      resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    };
    fetchAllResidentDataMock.mockResolvedValueOnce({ ...residentPayload });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-closed',
      record: {
        ServiceType: 'Assisted Living',
        StartDate: '2026-01-01',
        EndDate: '01/15/2026 12:00:00',
      },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-svc-change-closed',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
        Classification: 'Memory Care',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    const serviceWrites = upsertByFieldsMock.mock.calls.filter((c) => c[0] === 'Service_Table_API');
    expect(serviceWrites).toHaveLength(1);
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: '259' },
        { field: 'PatientNumber', value: '70508' },
        { field: 'ServiceType', value: 'Memory Care' },
      ]),
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        ServiceType: 'Memory Care',
        StartDate: '01/22/2026 12:00:00',
      }),
    );
  });

  it('basic_info_updated re-fetches classification when first read is unchanged', async () => {
    fetchAllResidentDataMock
      // initial fetch in handleUpdateEvent returns stale/old classification
      .mockResolvedValueOnce({
        resident: { Classification: 'Declined', ProductType: 'Declined' },
        basicInfo: {},
        insurance: [],
        roomAssignments: [{ RoomNumber: '53', IsPrimary: true }],
        diagnosesAndAllergies: [],
        contacts: [],
        community: null,
      })
      // second fetch in service comparison returns updated classification
      .mockResolvedValueOnce({
        resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
        basicInfo: {},
        insurance: [],
        roomAssignments: [{ RoomNumber: '53', IsPrimary: true }],
        diagnosesAndAllergies: [],
        contacts: [],
        community: null,
      });

    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '70508', CUID: '259', ApartmentNumber: '53' },
    });
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({
      found: true,
      record: { CUID: '259', CommunityName: 'Test Community' },
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-old',
      record: { ServiceType: 'Declined', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-service-change-refetch',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'svc-old', {
      EndDate: '01/22/2026 12:00:00',
    });
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.any(Array),
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        Room: '53',
        CommunityName: 'Test Community',
        ServiceType: 'Memory Care',
        StartDate: '01/22/2026 12:00:00',
      }),
    );
  });

  it('classification change treats default EndDate sentinel as active and closes previous row', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-default-enddate',
      record: {
        ServiceType: 'Assisted Living',
        StartDate: '2026-01-10',
        EndDate: '01/01/1900 00:00:00',
      },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-service-change-sentinel-enddate',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
        Classification: 'Memory Care',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'svc-default-enddate', {
      EndDate: '01/22/2026 12:00:00',
    });
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'StartDate', value: '01/22/2026 12:00:00' },
        { field: 'ServiceType', value: 'Memory Care' },
      ]),
      expect.objectContaining({
        PatientNumber: '70508',
        ServiceType: 'Memory Care',
        StartDate: '01/22/2026 12:00:00',
      }),
    );
  });

  it('basic_info_updated uses existing ApartmentNumber when event has no room', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '70508', CUID: '259', ApartmentNumber: '53' },
    });
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({
      found: true,
      record: { CUID: '259', CommunityName: 'Test Community' },
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-old',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-service-change-no-room',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        Classification: 'Memory Care',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(113, '53');
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.any(Array),
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        ServiceType: 'Memory Care',
      }),
    );
  });

  it('basic_info_updated prefers fetched resident room assignment when event has no room', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '77', IsPrimary: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '70508', CUID: '259', ApartmentNumber: '53' },
    });
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({
      found: true,
      record: { CUID: '259', CommunityName: 'Test Community' },
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-old',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-service-change-use-fetched-room',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        Classification: 'Memory Care',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(113, '77');
  });

  it('basic_info_updated skips service write and logs issue when room lookup is missing', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: { Classification: 'Memory Care', ProductType: 'Memory Care' },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '111', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: {
        PatientNumber: '70508',
        CUID: '259',
        CommunityName: 'Test Community',
        ApartmentNumber: '111',
      },
    });
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({ found: false });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-unassigned',
      record: { ServiceType: 'Unassigned', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-service-change-room-missing',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).not.toHaveBeenCalledWith(
      'Service_Table_API',
      expect.any(String),
      expect.any(Object),
    );
    const serviceUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'Service_Table_API',
    );
    expect(serviceUpserts).toHaveLength(0);
    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 10,
        eventType: 'residents.basic_info_updated',
        eventMessageId: 'evt-service-change-room-missing',
        residentId: 70508,
        communityId: 113,
        stage: 'caspio_community_lookup',
        severity: 'warning',
        details: { roomNumber: '111' },
      }),
    );
  });

  it('does not create patient/service rows for residents.created when patient does not exist', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
    findByPatientNumberMock.mockResolvedValueOnce({ found: false });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.created',
      EventMessageId: 'evt-created-no-patient',
      EventMessageDate: '2026-01-15T10:00:00Z',
      NotificationData: {
        ResidentId: 81234,
        RoomNumber: '110',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    const patientUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'CarePatientTable_API',
    );
    const serviceUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'Service_Table_API',
    );
    expect(patientUpserts).toHaveLength(0);
    expect(serviceUpserts).toHaveLength(0);
    expect(updateRecordByIdMock).not.toHaveBeenCalledWith(
      'CarePatientTable_API',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('skips service writes when community room match is missing', async () => {
    findCommunityByIdAndRoomNumberMock.mockResolvedValueOnce({ found: false });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_in',
      EventMessageId: 'evt-no-community-match',
      EventMessageDate: '2026-01-15T10:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    const serviceUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'Service_Table_API',
    );
    expect(serviceUpserts).toHaveLength(0);
  });

  it('resident.room_assigned prefers and normalizes notification room over stale API assignment', async () => {
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '1', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'resident.room_assigned',
      EventMessageId: 'evt-room-change',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '2 A',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.objectContaining({
        ApartmentNumber: '2A',
      }),
    );
    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(113, '2A');
  });

  it('room change when CUID changes closes old service, vacant old room, opens line on new CUID', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
    findByPatientNumberMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      raw: {
        PatientNumber: '70508',
        CUID: '111',
        ApartmentNumber: '1',
      },
    });
    getCommunityEnrichmentMock.mockImplementation((_communityId: number, room?: string | number | null) => {
      const r = room != null ? String(room).trim() : '';
      if (r === '1') {
        return Promise.resolve({ CUID: '111', CommunityName: 'Old Wing' });
      }
      return Promise.resolve({ CUID: '222', CommunityName: 'New Wing' });
    });
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '1', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValue({
      found: true,
      id: 'svc-old-cuid',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'resident.room_assigned',
      EventMessageId: 'evt-cuid-transfer',
      EventMessageDate: '2026-01-22T15:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '2',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'svc-old-cuid', {
      EndDate: '01/22/2026 15:00:00',
    });
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      [
        { field: 'CUID', value: '111' },
        { field: 'StartDate', value: '01/22/2026 15:00:00' },
        { field: 'ServiceType', value: 'Vacant' },
      ],
      expect.objectContaining({
        CUID: '111',
        ServiceType: 'Vacant',
      }),
    );
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      [
        { field: 'CUID', value: '222' },
        { field: 'StartDate', value: '01/22/2026 15:00:00' },
        { field: 'PatientNumber', value: '70508' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ],
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '222',
        ServiceType: 'Assisted Living',
      }),
    );
  });

  it('resident.room_changed resolves old CUID from UnassignedRoom and new CUID from AssignedRoom', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
    findByPatientNumberMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      raw: {
        PatientNumber: '71703',
        CUID: '111',
        ApartmentNumber: '54',
      },
    });
    findCommunityByIdAndRoomNumberMock.mockImplementation((_communityId: number, room: string) => {
      if (room === '54') {
        return Promise.resolve({
          found: true,
          record: { CUID: '111', CommunityName: 'Room 54' },
        });
      }
      if (room === '53') {
        return Promise.resolve({
          found: true,
          record: { CUID: '222', CommunityName: 'Room 53' },
        });
      }
      return Promise.resolve({
        found: true,
        record: { CUID: '259', CommunityName: 'Test Community' },
      });
    });
    getCommunityEnrichmentMock.mockImplementation((_communityId: number, room?: string | number | null) => {
      const r = room != null ? String(room).trim() : '';
      if (r === '54') {
        return Promise.resolve({ CUID: '111', CommunityName: 'Room 54' });
      }
      if (r === '53') {
        return Promise.resolve({ CUID: '222', CommunityName: 'Room 53' });
      }
      return Promise.resolve({ CUID: '259', CommunityName: 'Test Community' });
    });
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '54', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValue({
      found: true,
      id: 'svc-old-cuid',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'resident.room_changed',
      EventMessageId: '639104054955416800',
      EventMessageDate: '2026-03-29T18:24:55.5416825',
      NotificationData: {
        ResidentId: 71703,
        AsOfDateUTC: '2026-03-29T05:00:00',
        AssignedRoom: '53',
        UnassignedRoom: '54',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findCommunityByIdAndRoomNumberMock).toHaveBeenCalledWith(113, '54');
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.objectContaining({
        ApartmentNumber: '53',
        CUID: '222',
      }),
    );
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'Service_Table_API',
      'svc-old-cuid',
      expect.objectContaining({ EndDate: expect.any(String) }),
    );
    const vacantUpsert = upsertByFieldsMock.mock.calls.find(
      (c) =>
        c[0] === 'Service_Table_API' &&
        (c[2] as Record<string, unknown>)?.ServiceType === 'Vacant',
    );
    expect(vacantUpsert?.[1]).toEqual(
      expect.arrayContaining([
        { field: 'CUID', value: '111' },
        { field: 'ServiceType', value: 'Vacant' },
      ]),
    );
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: '222' },
        { field: 'PatientNumber', value: '71703' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ]),
      expect.objectContaining({
        PatientNumber: '71703',
        CUID: '222',
        ServiceType: 'Assisted Living',
      }),
    );
  });

  it('resident.room_changed still applies service transfer when Caspio row has move-out date fields (stale)', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
    findByPatientNumberMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      raw: {
        PatientNumber: '71703',
        CUID: '111',
        ApartmentNumber: '54',
        Move_Out_Date: '2026-01-01',
        Service_End_Date: '2026-01-01',
      },
    });
    findCommunityByIdAndRoomNumberMock.mockImplementation((_communityId: number, room: string) => {
      if (room === '54') {
        return Promise.resolve({
          found: true,
          record: { CUID: '111', CommunityName: 'Room 54' },
        });
      }
      if (room === '53') {
        return Promise.resolve({
          found: true,
          record: { CUID: '222', CommunityName: 'Room 53' },
        });
      }
      return Promise.resolve({
        found: true,
        record: { CUID: '259', CommunityName: 'Test Community' },
      });
    });
    getCommunityEnrichmentMock.mockImplementation((_communityId: number, room?: string | number | null) => {
      const r = room != null ? String(room).trim() : '';
      if (r === '54') {
        return Promise.resolve({ CUID: '111', CommunityName: 'Room 54' });
      }
      if (r === '53') {
        return Promise.resolve({ CUID: '222', CommunityName: 'Room 53' });
      }
      return Promise.resolve({ CUID: '259', CommunityName: 'Test Community' });
    });
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '54', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValue({
      found: true,
      id: 'svc-old-cuid',
      record: { ServiceType: 'Assisted Living', StartDate: '2026-01-10' },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'resident.room_changed',
      EventMessageId: '639104054955416801',
      EventMessageDate: '2026-03-29T18:24:55.5416825',
      NotificationData: {
        ResidentId: 71703,
        AsOfDateUTC: '2026-03-29T05:00:00',
        AssignedRoom: '53',
        UnassignedRoom: '54',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'Service_Table_API',
      'svc-old-cuid',
      expect.objectContaining({ EndDate: expect.any(String) }),
    );
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: '222' },
        { field: 'PatientNumber', value: '71703' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ]),
      expect.objectContaining({
        PatientNumber: '71703',
        CUID: '222',
        ServiceType: 'Assisted Living',
      }),
    );
  });

  it('does not overwrite On_Prem/Off_Prem from API when an open off-prem episode exists', async () => {
    findOpenOffPremEpisodeMock.mockResolvedValueOnce({
      found: true,
      id: 'ep-open',
      record: { OffPremStart: '2026-01-18T12:00:00' },
    });
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Assisted Living',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2026-01-10',
        IsOnLeave: false,
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '101', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.health_profile_updated',
      EventMessageId: 'evt-stale-leave-flag',
      EventMessageDate: '2026-01-22T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findOpenOffPremEpisodeMock).toHaveBeenCalled();
    const patientPatch = updateRecordByIdMock.mock.calls.find(
      (call) => call[0] === 'CarePatientTable_API',
    )?.[2] as Record<string, unknown> | undefined;
    expect(patientPatch).toBeDefined();
    expect(patientPatch).not.toHaveProperty('On_Prem');
    expect(patientPatch).not.toHaveProperty('Off_Prem');
  });

  it('basic_info_updated does not create or transition service rows when patient already moved out', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: {
        PatientNumber: '70508',
        CUID: '259',
        Move_Out_Date: '2026-01-20',
        Service_End_Date: '2026-01-20',
      },
    });
    fetchAllResidentDataMock.mockResolvedValueOnce({
      resident: {
        Classification: 'Intervene',
        ProductType: 'Intervene',
        PhysicalMoveInDate: '2026-01-10',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [{ RoomNumber: '101', IsPrimary: true, IsActiveAssignment: true }],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-after-moveout',
      EventMessageDate: '2026-01-23T12:00:00Z',
      NotificationData: {
        ResidentId: 70508,
        RoomNumber: '101',
        Classification: 'Intervene',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findActiveOrLatestServiceRowMock).not.toHaveBeenCalled();
    const serviceUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'Service_Table_API',
    );
    expect(serviceUpserts).toHaveLength(0);
  });

  it('move_in_out_info_updated does not transition service rows after move-out without room movement data', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: {
        PatientNumber: '392350',
        CUID: '965',
        CommunityName: 'YourLife Pensacola',
        ApartmentNumber: '218',
        Move_Out_Date: '04/22/2026',
        Service_End_Date: '04/22/2026',
      },
    });
    fetchAllResidentDataMock.mockReset();
    fetchAllResidentDataMock.mockResolvedValue({
      resident: {
        ProductType: '',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-vacant',
      record: {
        PatientNumber: '392350',
        CUID: '965',
        ServiceType: 'Vacant',
        StartDate: '04/24/2026 19:35:23',
      },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_in_out_info_updated',
      EventMessageId: 'evt-delayed-move-in-out-info',
      EventMessageDate: '2026-04-24T19:35:17.6921976Z',
      NotificationData: {
        ResidentId: 392350,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findActiveOrLatestServiceRowMock).not.toHaveBeenCalled();
    expect(updateRecordByIdMock).not.toHaveBeenCalledWith('Service_Table_API', expect.any(String), expect.any(Object));
    const serviceUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'Service_Table_API',
    );
    expect(serviceUpserts).toHaveLength(0);
  });

  it('skips stale fallback Unassigned transition when active row is later Vacant', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: {
        PatientNumber: '392350',
        CUID: '965',
        CommunityName: 'YourLife Pensacola',
        ApartmentNumber: '218',
      },
    });
    getCommunityEnrichmentMock.mockResolvedValue({
      CUID: '965',
      CommunityName: 'YourLife Pensacola',
    });
    findCommunityByIdAndRoomNumberMock.mockResolvedValue({
      found: true,
      record: { CUID: '965', CommunityName: 'YourLife Pensacola', RoomNumber: '218' },
    });
    fetchAllResidentDataMock.mockReset();
    fetchAllResidentDataMock.mockResolvedValue({
      resident: {
        ProductType: '',
      },
      basicInfo: {},
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'svc-vacant',
      record: {
        PatientNumber: '392350',
        CUID: '965',
        ServiceType: 'Vacant',
        StartDate: '04/24/2026 19:35:23',
      },
    });

    const event = {
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.basic_info_updated',
      EventMessageId: 'evt-stale-unassigned-after-vacant',
      EventMessageDate: '2026-04-24T19:35:17.6921976Z',
      NotificationData: {
        ResidentId: 392350,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findActiveOrLatestServiceRowMock).toHaveBeenCalledWith({
      patientNumber: '392350',
      cuid: '965',
    });
    expect(updateRecordByIdMock).not.toHaveBeenCalledWith('Service_Table_API', 'svc-vacant', expect.any(Object));
    const serviceUpserts = upsertByFieldsMock.mock.calls.filter(
      (call) => call[0] === 'Service_Table_API',
    );
    expect(serviceUpserts).toHaveLength(0);
  });
});
