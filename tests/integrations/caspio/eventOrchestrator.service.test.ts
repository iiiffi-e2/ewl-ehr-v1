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

import { handleAlisEvent } from '../../../src/integrations/caspio/eventOrchestrator.js';

describe('eventOrchestrator service-table scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAlisCredentialsMock.mockResolvedValue({ username: 'u', password: 'p' });
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
      record: { CUID: '259', CommunityName: 'Test Community' },
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
          { field: 'ServiceType', value: 'Vacay' },
        ],
        expect.objectContaining({
          CUID: '259',
          ServiceType: 'Vacay',
          StartDate: '01/21/2026 14:00:00',
          PatientNumber: '70508',
        }),
      );
      expect(upsertByFieldsMock).toHaveBeenCalledWith(
        'Service_Table_API',
        [
          { field: 'CUID', value: '259' },
          { field: 'StartDate', value: '01/21/2026 14:00:00' },
          { field: 'ServiceType', value: 'Vacant' },
        ],
        expect.objectContaining({
          CUID: '259',
          ServiceType: 'Vacant',
          StartDate: '01/21/2026 14:00:00',
        }),
      );
      const vacantPayload = upsertByFieldsMock.mock.calls.find(
        (call) =>
          call[0] === 'Service_Table_API' &&
          (call[2] as Record<string, unknown>)?.ServiceType === 'Vacant',
      )?.[2] as Record<string, unknown> | undefined;
      expect(vacantPayload).toBeDefined();
      expect(vacantPayload).not.toHaveProperty('PatientNumber');
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

  it('resident.room_assigned prefers notification room over stale API assignment', async () => {
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
        RoomNumber: '2',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.objectContaining({
        ApartmentNumber: '2',
      }),
    );
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
});
