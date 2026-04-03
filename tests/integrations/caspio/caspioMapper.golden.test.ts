import { mapPatientRecord, mapServiceRecord } from '../../../src/integrations/caspio/caspioMapper.js';
import type { AlisPayload } from '../../../src/integrations/alis/types.js';

describe('caspio mapper golden outputs', () => {
  it('maps canonical ALIS payload to stable patient/service records', () => {
    const payload: AlisPayload = {
      success: true,
      residentId: 70508,
      timestamp: '2026-04-03T12:00:00.000Z',
      apiBase: 'https://api.example.com',
      data: {
        resident: {
          ResidentId: 70508,
          Status: 'CurrentResident',
          FirstName: 'Jane',
          LastName: 'Doe',
          DateOfBirth: '1944-02-10T00:00:00Z',
          Classification: 'Assisted Living',
          ProductType: 'Assisted Living',
          Rooms: [{ RoomNumber: '101', Bed: 'A', IsPrimary: true }],
          IsOnLeave: false,
          PhysicalMoveInDate: '2026-01-10T00:00:00Z',
        },
        basicInfo: {
          ResidentId: 70508,
        },
        insurance: [
          {
            InsuranceName: 'Medicare',
            InsuranceType: 'MDCRA',
            AccountNumber: 'A-123',
            GroupNumber: 'G-1',
          },
        ],
        roomAssignments: [{ RoomNumber: '101', IsPrimary: true }],
        diagnosesAndAllergies: [{ Description: 'Hypertension' }],
        diagnosesAndAllergiesFull: {
          primaryDiagnoses: 'Hypertension',
          secondaryDiagnoses: 'Diabetes',
        },
        contacts: [
          {
            FirstName: 'John',
            LastName: 'Doe',
            RelationshipType: 'SON',
            PhoneNumber: '5551234567',
            Email: 'john@example.com',
          },
        ],
        community: {
          CommunityName: 'Sunrise',
          CommunityId: 113,
        },
      },
      counts: {
        insurance: 1,
        roomAssignments: 1,
        diagnosesAndAllergies: 1,
        contacts: 1,
      },
    };

    const patientRecord = mapPatientRecord(payload, {
      CUID: '259',
      CommunityName: 'Sunrise',
    });
    const serviceRecord = mapServiceRecord({
      patientNumber: '70508',
      cuid: '259',
      serviceType: 'Assisted Living',
      startDate: '01/10/2026 00:00:00',
      communityName: 'Sunrise',
    });

    expect(patientRecord).toMatchObject({
      PatientNumber: '70508',
      FirstName: 'Jane',
      LastName: 'Doe',
      PatientDOB: '1944-02-09',
      ApartmentNumber: '101',
      PatientPrimaryInsurance: 'Medicare',
      CUID: '259',
      CommunityName: 'Sunrise',
    });
    expect(serviceRecord).toMatchObject({
      PatientNumber: '70508',
      CUID: '259',
      ServiceType: 'Assisted Living',
      StartDate: '01/10/2026 00:00:00',
      CommunityName: 'Sunrise',
    });
  });
});
