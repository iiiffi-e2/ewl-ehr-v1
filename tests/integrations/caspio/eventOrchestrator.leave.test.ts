const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const updateRecordByIdMock = jest.fn();

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  findRecordByFields: findRecordByFieldsMock,
  findByPatientNumber: findByPatientNumberMock,
  upsertByFields: jest.fn(),
  updateRecordById: updateRecordByIdMock,
}));
jest.mock('../../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: jest.fn().mockResolvedValue({ CUID: 'C-113', CommunityName: 'Test Community' }),
}));

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
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

describe('eventOrchestrator leave events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('leave_start uses StartDateTime', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '101',
      record: {},
    });
    findByPatientNumberMock.mockResolvedValueOnce({ found: false });

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
  });

  it('leave_start falls back to EventMessageDate when StartDateTime missing', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '102',
      record: {},
    });
    findByPatientNumberMock.mockResolvedValueOnce({ found: false });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_start',
      NotificationData: {
        ...baseEvent.NotificationData,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', '102', {
      Off_Prem: true,
      Off_Prem_Date: '2026-01-19T19:23:35.2101857',
      On_Prem: false,
    });
  });

  it('leave_end uses EndDateTime', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '103',
      record: {},
    });
    findByPatientNumberMock.mockResolvedValueOnce({ found: false });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_end',
      NotificationData: {
        ...baseEvent.NotificationData,
        EndDateTime: '2026-01-19T13:00:00',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', '103', {
      On_Prem: true,
      On_Prem_Date: '2026-01-19T13:00:00',
      Off_Prem: false,
    });
  });

  it('leave_end falls back to EventMessageDate when EndDateTime missing', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: '104',
      record: {},
    });
    findByPatientNumberMock.mockResolvedValueOnce({ found: false });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_end',
      NotificationData: {
        ...baseEvent.NotificationData,
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', '104', {
      On_Prem: true,
      On_Prem_Date: '2026-01-19T19:23:35.2101857',
      Off_Prem: false,
    });
  });

  it('does not patch when resident does not exist', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({ found: false });
    findByPatientNumberMock.mockResolvedValueOnce({ found: false });

    const event = {
      ...baseEvent,
      EventType: 'residents.leave_start',
      NotificationData: {
        ...baseEvent.NotificationData,
        StartDateTime: '2026-01-19T13:00:00',
      },
    };

    await handleAlisEvent(event, 10, 'appstoresandbox');

    expect(updateRecordByIdMock).not.toHaveBeenCalled();
  });
});
