import { mapAlisPayloadToCaspioRecord, redactForLogs } from '../../../src/integrations/caspio/caspioMapper.js';
import type { AlisPayload } from '../../../src/integrations/alis/types.js';

describe('caspioMapper', () => {
  describe('mapAlisPayloadToCaspioRecord', () => {
    const basePayload: AlisPayload = {
      success: true,
      residentId: 12345,
      timestamp: '2024-01-15T10:00:00Z',
      apiBase: 'https://api.alis.com',
      data: {
        resident: {
          ResidentId: 12345,
          FirstName: 'John',
          LastName: 'Doe',
          DateOfBirth: '1945-03-15T00:00:00Z',
          ProductType: 'Assisted Living',
        },
        basicInfo: {
          ResidentId: 12345,
          ProductType: 'Assisted Living',
        },
        insurance: [],
        roomAssignments: [],
        diagnosesAndAllergies: [],
        contacts: [],
      },
      counts: {
        insurance: 0,
        roomAssignments: 0,
        diagnosesAndAllergies: 0,
        contacts: 0,
      },
    };

    it('maps Resident_ID correctly', () => {
      const result = mapAlisPayloadToCaspioRecord(basePayload);
      expect(result.Resident_ID).toBe('12345');
    });

    it('maps Resident_Name from firstName and lastName', () => {
      const result = mapAlisPayloadToCaspioRecord(basePayload);
      expect(result.Resident_Name).toBe('John Doe');
    });

    it('maps Resident_Name with trimmed whitespace', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            FirstName: '  Jane  ',
            LastName: '  Smith  ',
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Resident_Name).toBe('Jane Smith');
    });

    it('maps DOB to date part only (YYYY-MM-DD)', () => {
      const result = mapAlisPayloadToCaspioRecord(basePayload);
      expect(result.DOB).toBe('1945-03-15');
    });

    it('handles missing DOB gracefully', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            DateOfBirth: undefined,
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.DOB).toBeUndefined();
    });

    it('maps Move_in_Date from physicalMoveInDate', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            PhysicalMoveInDate: '2023-06-01T00:00:00Z',
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Move_in_Date).toBe('2023-06-01');
    });

    it('falls back to financialMoveInDate if physicalMoveInDate missing', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            FinancialMoveInDate: '2023-07-01T00:00:00Z',
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Move_in_Date).toBe('2023-07-01');
    });

    it('maps Room_number from active room assignment', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          roomAssignments: [
            {
              RoomNumber: '101',
              IsPrimary: false,
            },
            {
              RoomNumber: '202',
              IsPrimary: true,
            },
          ],
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Room_number).toBe('202');
    });

    it('falls back to first room assignment if no active assignment', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          roomAssignments: [
            {
              RoomNumber: '101',
              IsPrimary: false,
            },
          ],
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Room_number).toBe('101');
    });

    it('falls back to rooms array if no room assignments', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            Rooms: [
              {
                RoomNumber: '301',
                IsPrimary: true,
              },
            ],
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Room_number).toBe('301');
    });

    it('maps Service_Type from ProductType', () => {
      const result = mapAlisPayloadToCaspioRecord(basePayload);
      expect(result.Service_Type).toBe('Assisted Living');
    });

    it('maps On_Prem and Off_Prem based on isOnLeave', () => {
      const payloadOnLeave = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            IsOnLeave: true,
          },
        },
      };
      const resultOnLeave = mapAlisPayloadToCaspioRecord(payloadOnLeave);
      expect(resultOnLeave.On_Prem).toBe(false);
      expect(resultOnLeave.Off_Prem).toBe(true);

      const payloadNotOnLeave = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            IsOnLeave: false,
          },
        },
      };
      const resultNotOnLeave = mapAlisPayloadToCaspioRecord(payloadNotOnLeave);
      expect(resultNotOnLeave.On_Prem).toBe(true);
      expect(resultNotOnLeave.Off_Prem).toBe(false);
    });

    it('maps Off_Prem_Date when isOnLeave is true', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            IsOnLeave: true,
            OnLeaveStartDateUtc: '2024-01-10T00:00:00Z',
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Off_Prem_Date).toBe('2024-01-10');
    });

    it('does not set Off_Prem_Date when isOnLeave is false', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            IsOnLeave: false,
            OnLeaveStartDateUtc: '2024-01-10T00:00:00Z',
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Off_Prem_Date).toBeUndefined();
    });

    it('maps insurance data correctly', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          insurance: [
            {
              InsuranceName: 'Medicare',
              InsuranceType: 'Primary',
              GroupNumber: 'GRP123',
              AccountNumber: 'ACC456',
            },
            {
              InsuranceName: 'Blue Cross',
              InsuranceType: 'Secondary',
              GroupNumber: 'GRP789',
              AccountNumber: 'ACC012',
            },
          ],
        },
        counts: {
          ...basePayload.counts,
          insurance: 2,
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Insurance_Name).toBe('Medicare');
      expect(result.Insurance_Type).toBe('Primary');
      expect(result.Group_).toBe('GRP123');
      expect(result.Insurance_Number).toBe('ACC456');
      expect(result.Insurance_2_Name).toBe('Blue Cross');
      expect(result.Insurance_2_Type).toBe('Secondary');
      expect(result.Group_2_).toBe('GRP789');
      expect(result.Insurance_Number_2).toBe('ACC012');
    });

    it('maps diagnoses correctly', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          diagnosesAndAllergies: [
            {
              Type: 'Diagnosis',
              Description: 'Hypertension',
            },
            {
              Type: 'Diagnosis',
              Description: 'Diabetes',
            },
            {
              Type: 'Allergy',
              Description: 'Peanuts',
            },
          ],
        },
        counts: {
          ...basePayload.counts,
          diagnosesAndAllergies: 3,
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Diagnosis1).toBe('Hypertension');
      expect(result.Diagnosis2).toBe('Diabetes');
    });

    it('maps contacts correctly', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          contacts: [
            {
              FirstName: 'Jane',
              LastName: 'Doe',
              PhoneNumber: '555-1234',
              Email: 'jane@example.com',
              Address: '123 Main St',
              RelationshipType: 'Spouse',
            },
            {
              FirstName: 'Bob',
              LastName: 'Smith',
              PhoneNumber: '555-5678',
              Email: 'bob@example.com',
              Address: '456 Oak Ave',
              RelationshipType: 'Son',
            },
          ],
        },
        counts: {
          ...basePayload.counts,
          contacts: 2,
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.Contact_1_Name).toBe('Jane Doe');
      expect(result.Contact_1_Number).toBe('555-1234');
      expect(result.Contact_1_Email).toBe('jane@example.com');
      expect(result.Contact_1_Address).toBe('123 Main St');
      expect(result.Family_Contact_1).toBe('Spouse');
      expect(result.Contact_2_Name).toBe('Bob Smith');
      expect(result.Contact_2_Number).toBe('555-5678');
      expect(result.Contact_2_Email).toBe('bob@example.com');
      expect(result.Contact_2_Address).toBe('456 Oak Ave');
      expect(result.Family_Contact_2).toBe('Son');
    });

    it('strips undefined keys from result', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            DateOfBirth: undefined,
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result).not.toHaveProperty('DOB');
      expect(result.Resident_ID).toBeDefined();
      expect(result.Resident_Name).toBeDefined();
    });

    it('maps CommunityName from companyTextKey', () => {
      const payload = {
        ...basePayload,
        data: {
          ...basePayload.data,
          resident: {
            ...basePayload.data.resident,
            CompanyTextKey: 'Sunset Manor',
          },
        },
      };
      const result = mapAlisPayloadToCaspioRecord(payload);
      expect(result.CommunityName).toBe('Sunset Manor');
    });
  });

  describe('redactForLogs', () => {
    it('redacts SSN fields', () => {
      const obj = {
        Resident_ID: '123',
        SSN: '123-45-6789',
        Resident_Name: 'John Doe',
      };
      const result = redactForLogs(obj);
      expect(result).toEqual({
        Resident_ID: '123',
        SSN: '[REDACTED]',
        Resident_Name: 'John Doe',
      });
    });

    it('redacts Insurance_Number fields', () => {
      const obj = {
        Insurance_Number: 'ACC123',
        Insurance_Number_2: 'ACC456',
        Insurance_Name: 'Medicare',
      };
      const result = redactForLogs(obj);
      expect(result).toEqual({
        Insurance_Number: '[REDACTED]',
        Insurance_Number_2: '[REDACTED]',
        Insurance_Name: 'Medicare',
      });
    });

    it('redacts nested sensitive fields', () => {
      const obj = {
        resident: {
          SSN: '123-45-6789',
          name: 'John Doe',
        },
        insurance: {
          Insurance_Number: 'ACC123',
        },
      };
      const result = redactForLogs(obj);
      expect(result).toEqual({
        resident: {
          SSN: '[REDACTED]',
          name: 'John Doe',
        },
        insurance: {
          Insurance_Number: '[REDACTED]',
        },
      });
    });

    it('handles arrays', () => {
      const obj = [
        { SSN: '123-45-6789', name: 'John' },
        { SSN: '987-65-4321', name: 'Jane' },
      ];
      const result = redactForLogs(obj);
      expect(result).toEqual([
        { SSN: '[REDACTED]', name: 'John' },
        { SSN: '[REDACTED]', name: 'Jane' },
      ]);
    });

    it('handles non-object values', () => {
      expect(redactForLogs(null)).toBeNull();
      expect(redactForLogs(undefined)).toBeUndefined();
      expect(redactForLogs('string')).toBe('string');
      expect(redactForLogs(123)).toBe(123);
    });
  });
});


