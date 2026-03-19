import {
  buildOffPremEpisodeId,
  mapCommunityRecord,
  mapOffPremEndPatch,
  mapOffPremStartEpisode,
  mapPatientRecord,
  mapServiceRecord,
  redactForLogs,
} from '../../../src/integrations/caspio/caspioMapper.js';
import type { AlisPayload } from '../../../src/integrations/alis/types.js';

function buildPayload(): AlisPayload {
  return {
    success: true,
    residentId: 12345,
    timestamp: '2026-01-15T10:00:00Z',
    apiBase: 'https://api.alis.com',
    data: {
      resident: {
        ResidentId: 12345,
        Status: 'active',
        FirstName: 'John',
        LastName: 'Doe',
        DateOfBirth: '1945-03-15T00:00:00Z',
        ProductType: 'Assisted Living',
        PhysicalMoveInDate: '2024-01-01T00:00:00Z',
        IsOnLeave: false,
      },
      basicInfo: {
        ResidentId: 12345,
        ProductType: 'Assisted Living',
      },
      insurance: [
        {
          InsuranceName: 'Medicare',
          InsuranceType: 'medical',
          GroupNumber: 'GRP-1',
          AccountNumber: 'ACC-1',
        },
      ],
      roomAssignments: [{ RoomNumber: '101', IsPrimary: true }],
      diagnosesAndAllergies: [
        { Type: 'Diagnosis', Description: 'Hypertension' },
        { Type: 'Diagnosis', Description: 'Diabetes' },
      ],
      diagnosesAndAllergiesFull: {
        primaryDiagnoses: 'Hypertension',
        secondaryDiagnoses: 'Diabetes',
      },
      contacts: [
        {
          FirstName: 'Jane',
          LastName: 'Doe',
          RelationshipType: 'Spouse',
          PhoneNumber: '555-1111',
          Email: 'jane@example.com',
          Address: '123 Main St',
          additionalInfoTags: 'financial_power_of_attorney',
        } as any,
        {
          FirstName: 'Unmapped',
          LastName: 'Contact',
          RelationshipType: 'Friend',
          PhoneNumber: '555-9999',
          additionalInfoTags: 'social',
        } as any,
      ],
      community: {
        CommunityId: 113,
        CommunityName: 'Sunset Manor',
        Address: '1 Sunset Blvd',
        City: 'Dallas',
        State: 'TX',
        ZipCode: '75001',
      },
    },
    counts: {
      insurance: 1,
      roomAssignments: 1,
      diagnosesAndAllergies: 2,
      contacts: 2,
    },
  };
}

describe('caspioMapper new table mappings', () => {
  it('maps community payload into CommunityTable_API shape', () => {
    const record = mapCommunityRecord(buildPayload());
    expect(record).toEqual(
      expect.objectContaining({
        CommunityID: '113',
        CommunityName: 'Sunset Manor',
        Address: '1 Sunset Blvd',
        City: 'Dallas',
        State: 'TX',
        Zip: '75001',
        RoomNumber: '101',
      }),
    );
    expect(record.CUID).toBe('COMM-113');
  });

  it('maps patient payload and preserves raw PatientNumber', () => {
    const record = mapPatientRecord(buildPayload(), {
      CUID: '259',
      CommunityName: 'Sunset Manor',
    });

    expect(record.PatientNumber).toBe('12345');
    expect(record.PatientNumber).not.toContain('_');
    expect(record.CUID).toBe('259');
    expect(record.PatientCommunity).toBe('Sunset Manor');
    expect(record.ApartmentNumber).toBe('101');
    expect(record.Diagnosis1).toBe('Hypertension');
    expect(record.Diagnosis2).toBe('Diabetes');
  });

  it('prefers resident/basic address fields over community location', () => {
    const payload = buildPayload();
    (payload.data.resident as Record<string, unknown>).Address = '200 Resident Way';
    (payload.data.resident as Record<string, unknown>).City = 'Plano';
    (payload.data.resident as Record<string, unknown>).State = 'TX';
    (payload.data.resident as Record<string, unknown>).ZipCode = '75024';

    const record = mapPatientRecord(payload, {
      CUID: '259',
      CommunityName: 'Sunset Manor',
    });

    expect(record.PatientAddress).toBe('200 Resident Way');
    expect(record.PatientAddressCity).toBe('Plano');
    expect(record.PatientAddressState).toBe('TX');
    expect(record.PatientAddressZip).toBe('75024');
  });

  it('does not fall back to community location for patient address fields', () => {
    const payload = buildPayload();
    delete (payload.data.resident as Record<string, unknown>).Address;
    delete (payload.data.resident as Record<string, unknown>).City;
    delete (payload.data.resident as Record<string, unknown>).State;
    delete (payload.data.resident as Record<string, unknown>).ZipCode;
    delete (payload.data.basicInfo as Record<string, unknown>).Address;
    delete (payload.data.basicInfo as Record<string, unknown>).City;
    delete (payload.data.basicInfo as Record<string, unknown>).State;
    delete (payload.data.basicInfo as Record<string, unknown>).ZipCode;

    const record = mapPatientRecord(payload, {
      CUID: '259',
      CommunityName: 'Sunset Manor',
    });

    expect(record.PatientAddress).toBeUndefined();
    expect(record.PatientAddressCity).toBeUndefined();
    expect(record.PatientAddressState).toBeUndefined();
    expect(record.PatientAddressZip).toBeUndefined();
  });

  it('maps only financially-tagged contacts intentionally', () => {
    const record = mapPatientRecord(buildPayload(), {
      CUID: '259',
      CommunityName: 'Sunset Manor',
    });

    expect(record.FamilyContact1Name).toBe('Jane Doe');
    expect(record.FamilyContact1Relationship).toBe('Spouse');
    expect(record.FamilyContact2Name).toBeNull();
  });

  it('generates deterministic Service_ID when one is not provided', () => {
    const recordA = mapServiceRecord({
      patientNumber: '12345',
      cuid: '259',
      serviceType: 'Assisted Living',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
      communityName: 'Sunset Manor',
    });
    const recordB = mapServiceRecord({
      patientNumber: '12345',
      cuid: '259',
      serviceType: 'Assisted Living',
      startDate: '2024-01-01',
      endDate: '2024-03-01',
      communityName: 'Sunset Manor',
    });

    expect(recordA.Service_ID).toBe(recordB.Service_ID);
  });

  it('uses provided Service_ID verbatim when supplied', () => {
    const record = mapServiceRecord({
      patientNumber: '12345',
      serviceId: 'SVC-100',
      serviceType: 'Assisted Living',
    });
    expect(record.Service_ID).toBe('SVC-100');
  });

  it('allows service rows without PatientNumber', () => {
    const record = mapServiceRecord({
      cuid: '259',
      serviceType: 'Vacant',
      startDate: '2026-01-21',
    });
    expect(record).toEqual(
      expect.objectContaining({
        CUID: '259',
        ServiceType: 'Vacant',
        StartDate: '2026-01-21',
      }),
    );
    expect(record).not.toHaveProperty('PatientNumber');
  });

  it('builds deterministic off-prem Episode_ID without Leave_ID', () => {
    const idA = buildOffPremEpisodeId({
      patientNumber: '12345',
      cuid: '259',
      offPremStart: '2026-01-19T13:00:00',
    });
    const idB = buildOffPremEpisodeId({
      patientNumber: '12345',
      cuid: '259',
      offPremStart: '2026-01-19T13:00:00',
    });
    expect(idA).toBe(idB);
  });

  it('uses leave-based Episode_ID when Leave_ID exists', () => {
    const id = buildOffPremEpisodeId({
      patientNumber: '12345',
      cuid: '259',
      leaveId: 285,
      offPremStart: '2026-01-19T13:00:00',
    });
    expect(id).toBe('leave:12345:259:285');
  });

  it('maps off-prem start episode with patient and community linkage', () => {
    const episode = mapOffPremStartEpisode({
      patientNumber: '12345',
      cuid: '259',
      communityName: 'Sunset Manor',
      leaveId: 285,
      offPremStart: '2026-01-19T13:00:00',
    });
    expect(episode).toEqual(
      expect.objectContaining({
        Episode_ID: 'leave:12345:259:285',
        PatientNumber: '12345',
        CUID: '259',
        Leave_ID: '285',
        OffPremStart: '2026-01-19T13:00:00',
        IsOpen: true,
      }),
    );
  });

  it('maps off-prem end patch with duration fields', () => {
    const patch = mapOffPremEndPatch({
      offPremStart: '2026-01-19T13:00:00',
      offPremEnd: '2026-01-19T15:30:00',
      closeReason: 'leave_end',
    });
    expect(patch).toEqual(
      expect.objectContaining({
        OffPremEnd: '2026-01-19T15:30:00',
        DurationMinutes: 150,
        DurationHours: 2.5,
        IsOpen: false,
        CloseReason: 'leave_end',
      }),
    );
  });
});

describe('redactForLogs', () => {
  it('redacts nested SSN and insurance numbers', () => {
    const result = redactForLogs({
      SSN: '111-22-3333',
      Insurance_Number: 'ACC-123',
      nested: { Insurance_Number_2: 'ACC-456' },
    });
    expect(result).toEqual({
      SSN: '[REDACTED]',
      Insurance_Number: '[REDACTED]',
      nested: { Insurance_Number_2: '[REDACTED]' },
    });
  });
});
