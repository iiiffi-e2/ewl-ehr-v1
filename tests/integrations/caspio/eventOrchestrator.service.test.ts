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
      [
        { field: 'PatientNumber', value: '70508' },
        { field: 'CUID', value: '259' },
        { field: 'StartDate', value: '2026-01-10' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ],
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        CommunityName: 'Test Community',
        ServiceType: 'Assisted Living',
        StartDate: '2026-01-10',
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

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'svc-1', {
      EndDate: '2026-01-20',
    });
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
      EndDate: '2026-01-22T12:00:00Z',
    });
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      [
        { field: 'PatientNumber', value: '70508' },
        { field: 'CUID', value: '259' },
        { field: 'StartDate', value: '2026-01-22T12:00:00Z' },
        { field: 'ServiceType', value: 'Memory Care' },
      ],
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: '259',
        ServiceType: 'Memory Care',
        StartDate: '2026-01-22T12:00:00Z',
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
});
