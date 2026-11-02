import {
  parseServiceExportCsv,
  proposeServiceRowRepair,
  repairActionsToCsv,
  type ServiceExportRow,
} from '../../../src/integrations/caspio/serviceRowRepair.js';

function row(overrides: Partial<ServiceExportRow> & Pick<ServiceExportRow, 'serviceId'>): ServiceExportRow {
  return {
    cuid: '259',
    patientNumber: '',
    serviceType: 'Vacant',
    startDate: '10/24/2026 00:00:00',
    endDate: '',
    changeTimeStamp: '10/28/2026 2:41:09 PM',
    roomNumber: '305B',
    ...overrides,
  };
}

describe('proposeServiceRowRepair', () => {
  it('deletes the resident-linked vacant when a room-level vacant was written in the same second', () => {
    const actions = proposeServiceRowRepair([
      row({ serviceId: '2478', startDate: '10/24/2026 00:00:00' }),
      row({
        serviceId: '2479',
        patientNumber: '70508',
        startDate: '10/28/2026 13:41:05',
        changeTimeStamp: '10/28/2026 2:41:09 PM',
      }),
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        serviceId: '2479',
        action: 'delete',
        reason: 'duplicate_vacant_same_second',
      }),
    ]);
  });

  it('closes an open vacant at the move-in row start', () => {
    const actions = proposeServiceRowRepair([
      row({ serviceId: '100', startDate: '10/01/2026 00:00:00', changeTimeStamp: '10/01/2026 9:00:00 AM' }),
      row({
        serviceId: '101',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/24/2026 00:00:00',
        changeTimeStamp: '10/24/2026 11:00:00 AM',
      }),
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        serviceId: '100',
        action: 'set_end_date',
        proposedEndDate: '10/24/2026 00:00:00',
        reason: 'superseded_by_later_open_row',
      }),
    ]);
  });

  it('closes the older room when one resident is open in two rooms', () => {
    const actions = proposeServiceRowRepair([
      row({
        serviceId: '200',
        cuid: '102A',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/01/2026 00:00:00',
        roomNumber: '102A',
        changeTimeStamp: '10/01/2026 9:00:00 AM',
      }),
      row({
        serviceId: '201',
        cuid: '102B',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/15/2026 00:00:00',
        roomNumber: '102B',
        changeTimeStamp: '10/15/2026 9:00:00 AM',
      }),
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        serviceId: '200',
        action: 'set_end_date',
        proposedEndDate: '10/15/2026 00:00:00',
        reason: 'resident_open_in_multiple_rooms',
      }),
    ]);
  });

  it('leaves a legacy row without ChangeTimeStamp for manual review', () => {
    const actions = proposeServiceRowRepair([
      row({
        serviceId: '50',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/27/2025 3:19:33 PM',
        changeTimeStamp: '',
        roomNumber: '182 A',
      }),
      row({
        serviceId: '51',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/24/2026 00:00:00',
        changeTimeStamp: '10/24/2026 11:00:00 AM',
        roomNumber: '182A',
      }),
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        serviceId: '50',
        action: 'manual_review',
        reason: 'legacy_row_without_change_timestamp',
      }),
    ]);
  });

  it('ignores rows that already have an EndDate', () => {
    const actions = proposeServiceRowRepair([
      row({ serviceId: '10', endDate: '10/24/2026 00:00:00' }),
      row({
        serviceId: '11',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/24/2026 00:00:00',
      }),
    ]);

    expect(actions).toEqual([]);
  });

  it('treats a spaced room number as the same room when CUID is blank', () => {
    const actions = proposeServiceRowRepair([
      row({
        serviceId: '300',
        cuid: '',
        startDate: '10/01/2026',
        roomNumber: '182 A',
        changeTimeStamp: '10/01/2026 9:00:00 AM',
      }),
      row({
        serviceId: '301',
        cuid: '',
        patientNumber: '70508',
        serviceType: 'Assisted Living',
        startDate: '10/24/2026',
        roomNumber: '182A',
        changeTimeStamp: '10/24/2026 11:00:00 AM',
      }),
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        serviceId: '300',
        action: 'set_end_date',
        proposedEndDate: '10/24/2026',
        reason: 'superseded_by_later_open_row',
      }),
    ]);
  });

  it('round-trips a quoted export into a proposal CSV', () => {
    const parsed = parseServiceExportCsv(
      [
        'Service_ID,CUID,PatientNumber,ServiceType,StartDate,EndDate,ChangeTimeStamp,RoomNumber',
        '2478,259,,Vacant,10/24/2026 00:00:00,,10/28/2026 2:41:09 PM,305B',
        '2479,259,70508,Vacant,10/28/2026 13:41:05,,"10/28/2026 2:41:09 PM",305B',
        '2480,259,70508,Intervene 12,10/01/2026,10/28/2026 14:41:05,10/28/2026 2:41:10 PM,305B',
      ].join('\n'),
    );

    const csv = repairActionsToCsv(proposeServiceRowRepair(parsed));
    expect(csv).toContain('2479,delete,,duplicate_vacant_same_second');
    expect(csv).not.toContain('2480,');
  });
});
