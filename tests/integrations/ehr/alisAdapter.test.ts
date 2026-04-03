const getResidentMock = jest.fn();
const getResidentBasicInfoMock = jest.fn();
const getResidentLeavesMock = jest.fn();
const getLeaveMock = jest.fn();
const fetchAllResidentDataMock = jest.fn();
const resolveAlisCredentialsMock = jest.fn();

jest.mock('../../../src/integrations/alisClient.js', () => ({
  createAlisClient: jest.fn(() => ({
    getResident: getResidentMock,
    getResidentBasicInfo: getResidentBasicInfoMock,
    getResidentLeaves: getResidentLeavesMock,
    getLeave: getLeaveMock,
  })),
  fetchAllResidentData: fetchAllResidentDataMock,
  resolveAlisCredentials: resolveAlisCredentialsMock,
}));

import { AlisAdapter } from '../../../src/integrations/ehr/alisAdapter.js';

describe('AlisAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAlisCredentialsMock.mockResolvedValue({ username: 'u', password: 'p' });
    getResidentMock.mockResolvedValue({
      ResidentId: 70508,
      Status: 'CurrentResident',
      FirstName: 'Jane',
      LastName: 'Doe',
      DateOfBirth: '1944-02-10T00:00:00Z',
      Classification: 'Assisted Living',
      ProductType: 'Assisted Living',
      Rooms: [{ RoomNumber: '101', Bed: 'A', Room: '101 A', IsPrimary: true }],
    });
    getResidentBasicInfoMock.mockResolvedValue({
      ResidentId: 70508,
      Classification: 'Assisted Living',
    });
    getResidentLeavesMock.mockResolvedValue([]);
    getLeaveMock.mockResolvedValue({
      LeaveId: 285,
      ResidentId: 70508,
      StartDate: '2026-01-19T13:00:00',
    });
    fetchAllResidentDataMock.mockResolvedValue({
      resident: { ResidentId: 70508 },
      basicInfo: { ResidentId: 70508 },
      insurance: [],
      roomAssignments: [],
      diagnosesAndAllergies: [],
      contacts: [],
      community: null,
    });
  });

  it('parses ALIS webhook payload into canonical event', () => {
    const adapter = new AlisAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.move_in',
      EventMessageId: 'evt-1',
      EventMessageDate: '2026-01-19T19:23:35.2101857',
      NotificationData: {
        ResidentId: 70508,
      },
    });

    expect(event).toMatchObject({
      source: 'alis',
      companyKey: 'appstoresandbox',
      communityId: 113,
      eventType: 'residents.move_in',
      eventMessageId: 'evt-1',
      lifecycleKind: 'move_in',
      notificationData: { ResidentId: 70508 },
    });
  });

  it('fetches resident bundle and maps demographics', async () => {
    const adapter = new AlisAdapter();
    const event = adapter.parseInboundEvent({
      CompanyKey: 'appstoresandbox',
      CommunityId: 113,
      EventType: 'residents.leave_start',
      EventMessageId: 'evt-2',
      EventMessageDate: '2026-01-19T19:23:35.2101857',
      NotificationData: {
        ResidentId: 70508,
        LeaveId: 285,
      },
    });

    const residentId = adapter.resolveResidentId({ event });
    const bundle = await adapter.fetchResidentBundle({
      companyId: 10,
      companyKey: 'appstoresandbox',
      event,
      residentId,
    });

    expect(bundle.source).toBe('alis');
    expect(bundle.residentId).toBe(70508);
    expect(bundle.demographics).toMatchObject({
      externalResidentId: '70508',
      firstName: 'Jane',
      lastName: 'Doe',
      roomNumber: '101',
      bed: 'A',
    });
    expect(resolveAlisCredentialsMock).toHaveBeenCalledWith(10, 'appstoresandbox');
    expect(fetchAllResidentDataMock).toHaveBeenCalledWith(
      { username: 'u', password: 'p' },
      70508,
      113,
    );
  });
});
