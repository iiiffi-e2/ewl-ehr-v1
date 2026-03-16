const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const findOpenOffPremEpisodeMock = jest.fn();
const upsertByFieldsMock = jest.fn();
const upsertOffPremEpisodeByEpisodeIdMock = jest.fn();
const updateRecordByIdMock = jest.fn();

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  findRecordByFields: findRecordByFieldsMock,
  findByPatientNumber: findByPatientNumberMock,
  findOpenOffPremEpisode: findOpenOffPremEpisodeMock,
  upsertByFields: upsertByFieldsMock,
  upsertOffPremEpisodeByEpisodeId: upsertOffPremEpisodeByEpisodeIdMock,
  updateRecordById: updateRecordByIdMock,
}));
jest.mock('../../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: jest.fn().mockResolvedValue({ CUID: 'C-113', CommunityName: 'Test Community' }),
}));
jest.mock('../../../src/integrations/alisClient.js', () => ({
  fetchAllResidentData: jest.fn().mockResolvedValue({
    resident: { Classification: 'Assisted Living', ProductType: 'Assisted Living' },
    basicInfo: {},
    insurance: [],
    roomAssignments: [],
    diagnosesAndAllergies: [],
    contacts: [],
  }),
  resolveAlisCredentials: jest.fn().mockResolvedValue({ username: 'u', password: 'p' }),
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

describe('eventOrchestrator leave events with off-prem history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upsertByFieldsMock.mockResolvedValue({ action: 'update', id: 'svc-1' });
    upsertOffPremEpisodeByEpisodeIdMock.mockResolvedValue({ action: 'update', id: 'ep-1' });
    findOpenOffPremEpisodeMock.mockResolvedValue({
      found: true,
      id: 'ep-1',
      record: { OffPremStart: '2026-01-19T13:00:00' },
    });
  });

  const baseEvent = {
    CompanyKey: 'appstoresandbox',
    CommunityId: 113,
    EventMessageId: 'evt-1',
    EventMessageDate: '2026-01-19T19:23:35.2101857',
    NotificationData: {
      ResidentId: 70508,
      LeaveId: 285,
    },
  };

  it('leave_start creates open off-prem episode and patches patient flags', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '101',
      record: {},
    });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_start',
      NotificationData: {
        ...baseEvent.NotificationData,
        StartDateTime: '2026-01-19T13:00:00',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', '101', {
      Off_Prem: true,
      Off_Prem_Date: '2026-01-19T13:00:00',
      On_Prem: false,
    });
    expect(upsertOffPremEpisodeByEpisodeIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: 'C-113',
        Leave_ID: '285',
        OffPremStart: '2026-01-19T13:00:00',
        IsOpen: true,
      }),
    );
  });

  it('leave_start is idempotent by Episode_ID for duplicate events', async () => {
    findRecordByFieldsMock
      .mockResolvedValueOnce({ found: true, id: '101', record: {} })
      .mockResolvedValueOnce({ found: true, id: '101', record: {} });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_start',
      NotificationData: {
        ...baseEvent.NotificationData,
        StartDateTime: '2026-01-19T13:00:00',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');
    await handleAlisEvent(event, 10, 'appstoresandbox');

    const firstEpisode = upsertOffPremEpisodeByEpisodeIdMock.mock.calls[0][0];
    const secondEpisode = upsertOffPremEpisodeByEpisodeIdMock.mock.calls[1][0];
    expect(firstEpisode.Episode_ID).toBe(secondEpisode.Episode_ID);
  });

  it('leave_end closes open episode and computes duration', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '103',
      record: {},
    });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_end',
      EventMessageId: 'evt-2',
      NotificationData: {
        ...baseEvent.NotificationData,
        EndDateTime: '2026-01-19T15:00:00',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', '103', {
      On_Prem: true,
      On_Prem_Date: '2026-01-19T15:00:00',
      Off_Prem: false,
    });
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'PatientOffPremHistory_API',
      'ep-1',
      expect.objectContaining({
        OffPremEnd: '2026-01-19T15:00:00',
        DurationMinutes: 120,
        IsOpen: false,
        CloseReason: 'leave_end',
      }),
    );
  });

  it('leave_end fallback lookup works when LeaveId is absent', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '104',
      record: {},
    });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_end',
      NotificationData: {
        ResidentId: 70508,
        EndDateTime: '2026-01-19T16:00:00',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(findOpenOffPremEpisodeMock).toHaveBeenCalledWith({
      patientNumber: '70508',
      cuid: 'C-113',
      leaveId: undefined,
    });
  });

  it('move_out closes service and any open off-prem episode', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '201',
      record: {
        PatientNumber: '70508',
        CUID: 'C-113',
        CommunityName: 'Test Community',
        Move_in_Date: '2025-01-01',
        Service_Start_Date: '2025-01-01',
      },
    });

    const event = {
      ...baseEvent,
      EventType: 'residents.move_out',
      NotificationData: {
        ...baseEvent.NotificationData,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      '201',
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: 'C-113',
        Move_Out_Date: expect.any(String),
        Service_End_Date: expect.any(String),
      }),
    );

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      [{ field: 'Service_ID', value: expect.any(String) }],
      expect.objectContaining({
        PatientNumber: '70508',
        CUID: 'C-113',
        EndDate: expect.any(String),
      }),
    );

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'PatientOffPremHistory_API',
      'ep-1',
      expect.objectContaining({
        IsOpen: false,
        CloseReason: 'move_out',
      }),
    );
  });
});
