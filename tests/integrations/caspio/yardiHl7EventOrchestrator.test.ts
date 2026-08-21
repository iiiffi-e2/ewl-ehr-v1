const getCommunityEnrichmentMock = jest.fn();
const upsertByFieldsMock = jest.fn();
const updateRecordByIdMock = jest.fn();
const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const findActiveOrLatestServiceRowMock = jest.fn();
const findOpenOffPremEpisodeMock = jest.fn();
const upsertOffPremEpisodeByEpisodeIdMock = jest.fn();
const recordEventIssueMock = jest.fn();
const handleAlisEventMock = jest.fn();
const buildYardiFhirCaspioRecordsMock = jest.fn();

jest.mock('../../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: getCommunityEnrichmentMock,
}));

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  upsertByFields: upsertByFieldsMock,
  updateRecordById: updateRecordByIdMock,
  findRecordByFields: findRecordByFieldsMock,
  findByPatientNumber: findByPatientNumberMock,
  findActiveOrLatestServiceRow: findActiveOrLatestServiceRowMock,
  findOpenOffPremEpisode: findOpenOffPremEpisodeMock,
  upsertOffPremEpisodeByEpisodeId: upsertOffPremEpisodeByEpisodeIdMock,
}));

jest.mock('../../../src/domains/eventIssues.js', () => ({
  recordEventIssue: recordEventIssueMock,
}));

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
    CASPIO_OFF_PREM_HISTORY_TABLE_NAME: 'PatientOffPremHistory_API',
  },
}));

jest.mock('../../../src/integrations/caspio/eventOrchestrator.js', () => ({
  handleAlisEvent: handleAlisEventMock,
}));

jest.mock('../../../src/integrations/yardi/yardiFhirSync.js', () => ({
  buildYardiFhirCaspioRecords: buildYardiFhirCaspioRecordsMock,
  extractYardiCommunityName: jest.fn(),
}));

import type {
  CanonicalEventOrchestrationInput,
  CanonicalResidentBundle,
} from '../../../src/integrations/ehr/types.js';
import { handleYardiHl7Event } from '../../../src/integrations/caspio/yardiHl7EventOrchestrator.js';

function baseInput(
  eventType = 'hl7.adt.a01',
  extras: {
    communityId?: number | null;
    trigger?: string;
    demographics?: Partial<CanonicalResidentBundle['demographics']>;
  } = {},
): CanonicalEventOrchestrationInput {
  const communityId = extras.communityId === undefined ? 113 : extras.communityId;
  const event = {
    source: 'yardi-hl7' as const,
    companyKey: 'yardi-company',
    communityId,
    eventType,
    eventMessageId: 'yardi-hl7-event-1',
    eventMessageDate: '2026-08-20T14:15:16Z',
    lifecycleKind: 'move_in' as const,
    notificationData: {
      TriggerEvent: extras.trigger ?? 'A01',
      ResidentId: 418612,
      RoomNumber: '141',
      SendingFacility: 'EyeWatch Live',
    },
    raw: {},
  };
  const residentBundle: CanonicalResidentBundle = {
    source: 'yardi-hl7',
    companyId: 10,
    companyKey: 'yardi-company',
    communityId,
    residentId: 418612,
    event,
    demographics: {
      externalResidentId: '418612',
      firstName: 'Denise',
      lastName: 'Morgan',
      dateOfBirth: '2022-09-01T00:00:00.000Z',
      roomNumber: '141',
      classification: 'Assisted Living',
      ...extras.demographics,
    },
    vendorPayload: { hl7: 'MSH|...', parsed: {} },
  };

  return {
    source: 'yardi-hl7',
    companyId: 10,
    companyKey: 'yardi-company',
    event,
    residentBundle,
  };
}

describe('handleYardiHl7Event', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCommunityEnrichmentMock.mockResolvedValue({
      CUID: 'room-cuid',
      CommunityName: 'EyeWatch Live',
    });
    upsertByFieldsMock.mockResolvedValue({ action: 'insert', id: 'record-1' });
    updateRecordByIdMock.mockResolvedValue({});
    findRecordByFieldsMock.mockResolvedValue({ found: false });
    findByPatientNumberMock.mockResolvedValue({ found: false });
    findActiveOrLatestServiceRowMock.mockResolvedValue({ found: false });
    findOpenOffPremEpisodeMock.mockResolvedValue({ found: false });
    upsertOffPremEpisodeByEpisodeIdMock.mockResolvedValue({
      action: 'insert',
      id: 'episode-1',
    });
  });

  it('records a non-retryable warning and skips writes when communityId is missing', async () => {
    await handleYardiHl7Event(baseInput('hl7.adt.a01', { communityId: null }));

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 10,
        source: 'yardi-hl7',
        eventType: 'hl7.adt.a01',
        eventMessageId: 'yardi-hl7-event-1',
        stage: 'missing_community_id',
        severity: 'warning',
        retryable: false,
      }),
    );
    expect(upsertByFieldsMock).not.toHaveBeenCalled();
  });

  it('records missing_cuid and skips patient writes when room enrichment has no CUID', async () => {
    getCommunityEnrichmentMock.mockResolvedValueOnce({ CommunityName: 'EyeWatch Live' });

    await handleYardiHl7Event(baseInput());

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'missing_cuid',
        severity: 'warning',
        retryable: false,
        residentId: 418612,
        communityId: 113,
      }),
    );
    expect(upsertByFieldsMock).not.toHaveBeenCalled();
  });

  it('upserts the A01 patient and service using the enriched CUID', async () => {
    await handleYardiHl7Event(baseInput());

    expect(getCommunityEnrichmentMock).toHaveBeenCalledWith(113, '141', undefined);
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      [
        { field: 'PatientNumber', value: '418612' },
        { field: 'CUID', value: 'room-cuid' },
      ],
      expect.objectContaining({
        PatientNumber: '418612',
        CUID: 'room-cuid',
        RoomNumber: '141',
        FirstName: 'Denise',
        LastName: 'Morgan',
        Move_in_Date: '08/20/2026 14:15:16',
      }),
    );
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: 'room-cuid' },
        { field: 'PatientNumber', value: '418612' },
        { field: 'StartDate', value: '08/20/2026 14:15:16' },
        { field: 'ServiceType', value: 'Assisted Living' },
      ]),
      expect.objectContaining({
        CUID: 'room-cuid',
        PatientNumber: '418612',
        StartDate: '08/20/2026 14:15:16',
        ServiceType: 'Assisted Living',
      }),
    );
  });

  it('does not delegate A01 to the ALIS orchestrator', async () => {
    await handleYardiHl7Event(baseInput());

    expect(handleAlisEventMock).not.toHaveBeenCalled();
  });

  it('transfers A02 from the previous CUID service to the enriched room CUID', async () => {
    getCommunityEnrichmentMock.mockResolvedValue({
      CUID: 'new-cuid',
      CommunityName: 'EyeWatch Live',
    });
    findByPatientNumberMock.mockResolvedValue({
      found: true,
      id: 'patient-1',
      raw: { PatientNumber: '418612', CUID: 'old-cuid', RoomNumber: '100' },
    });
    findActiveOrLatestServiceRowMock.mockResolvedValue({
      found: true,
      id: 'old-service-1',
      record: { CUID: 'old-cuid' },
    });

    await handleYardiHl7Event(baseInput('hl7.adt.a02', { trigger: 'A02' }));
    getCommunityEnrichmentMock.mockResolvedValue({
      CUID: 'room-cuid',
      CommunityName: 'EyeWatch Live',
    });
    findByPatientNumberMock.mockResolvedValue({ found: false });
    findActiveOrLatestServiceRowMock.mockResolvedValue({ found: false });

    expect(findActiveOrLatestServiceRowMock).toHaveBeenCalledWith({
      patientNumber: '418612',
      cuid: 'old-cuid',
    });
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'Service_Table_API',
      'old-service-1',
      { EndDate: '08/20/2026 14:15:16' },
    );
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: 'new-cuid' },
        { field: 'PatientNumber', value: '418612' },
        { field: 'StartDate', value: '08/20/2026 14:15:16' },
      ]),
      expect.objectContaining({
        CUID: 'new-cuid',
        PatientNumber: '418612',
        RoomNumber: '141',
        StartDate: '08/20/2026 14:15:16',
      }),
    );
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.objectContaining({
        PatientNumber: '418612',
        RoomNumber: '141',
        CUID: 'new-cuid',
      }),
    );
  });

  it('inserts an A05 patient and service when the patient is missing', async () => {
    await handleYardiHl7Event(baseInput('hl7.adt.a05', { trigger: 'A05' }));

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      [
        { field: 'PatientNumber', value: '418612' },
        { field: 'CUID', value: 'room-cuid' },
      ],
      expect.objectContaining({
        PatientNumber: '418612',
        CUID: 'room-cuid',
        RoomNumber: '141',
      }),
    );
    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      expect.arrayContaining([
        { field: 'CUID', value: 'room-cuid' },
        { field: 'PatientNumber', value: '418612' },
      ]),
      expect.objectContaining({
        CUID: 'room-cuid',
        PatientNumber: '418612',
      }),
    );
  });

  it.each(['A08', 'A60'])(
    'records an issue and skips %s when the patient is missing',
    async (trigger) => {
      await handleYardiHl7Event(
        baseInput(`hl7.adt.${trigger.toLowerCase()}`, { trigger }),
      );

      expect(recordEventIssueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'patient_not_found',
          message: `${trigger} event skipped because resident was not found in Caspio`,
        }),
      );
      expect(updateRecordByIdMock).not.toHaveBeenCalled();
      expect(upsertByFieldsMock).not.toHaveBeenCalled();
    },
  );

  it.each(['A08', 'A60'])('updates the existing patient for %s', async (trigger) => {
    findRecordByFieldsMock.mockResolvedValue({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });

    await handleYardiHl7Event(
      baseInput(`hl7.adt.${trigger.toLowerCase()}`, { trigger }),
    );
    findRecordByFieldsMock.mockResolvedValue({ found: false });

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.objectContaining({
        PatientNumber: '418612',
        RoomNumber: '141',
        CUID: 'room-cuid',
      }),
    );
    expect(upsertByFieldsMock).not.toHaveBeenCalled();
  });

  it('strips move and presence fields from a FHIR-overlaid A08 patch', async () => {
    findRecordByFieldsMock.mockResolvedValue({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });
    buildYardiFhirCaspioRecordsMock.mockResolvedValue({
      patientRecord: {
        PatientNumber: '418612',
        FirstName: 'FHIR Denise',
        Move_in_Date: '01/01/2020 00:00:00',
        On_Prem: true,
        On_Prem_Date: '01/01/2020 00:00:00',
        Off_Prem: false,
        Off_Prem_Date: '01/02/2020 00:00:00',
      },
    });
    const input = baseInput('hl7.adt.a08', { trigger: 'A08' });
    input.residentBundle!.vendorPayload = {
      hl7: 'MSH|...',
      parsed: {},
      fhirBundle: { resourceType: 'Bundle', entry: [] },
    } as any;

    await handleYardiHl7Event(input);

    const patientPatch = updateRecordByIdMock.mock.calls.find(
      ([table, id]) => table === 'CarePatientTable_API' && id === 'patient-1',
    )?.[2];
    expect(patientPatch).toEqual(
      expect.objectContaining({
        PatientNumber: '418612',
        FirstName: 'FHIR Denise',
      }),
    );
    expect(patientPatch).not.toHaveProperty('Move_in_Date');
    expect(patientPatch).not.toHaveProperty('On_Prem');
    expect(patientPatch).not.toHaveProperty('On_Prem_Date');
    expect(patientPatch).not.toHaveProperty('Off_Prem');
    expect(patientPatch).not.toHaveProperty('Off_Prem_Date');
  });

  it('updates the patient and closes the latest service for A03', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });
    findActiveOrLatestServiceRowMock.mockResolvedValueOnce({
      found: true,
      id: 'service-1',
      record: { Service_ID: 'service-id' },
    });

    await handleYardiHl7Event(baseInput('hl7.adt.a03', { trigger: 'A03' }));

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', 'patient-1', {
      Move_Out_Date: '08/20/2026 14:15:16',
      Service_End_Date: '08/20/2026 14:15:16',
      On_Prem: false,
    });
    expect(findActiveOrLatestServiceRowMock).toHaveBeenCalledWith({
      patientNumber: '418612',
      cuid: 'room-cuid',
    });
    expect(updateRecordByIdMock).toHaveBeenCalledWith('Service_Table_API', 'service-1', {
      EndDate: '08/20/2026 14:15:16',
    });
  });

  it('records an issue and skips A03 updates when the patient is missing', async () => {
    await handleYardiHl7Event(baseInput('hl7.adt.a03', { trigger: 'A03' }));

    expect(findRecordByFieldsMock).toHaveBeenCalledWith('CarePatientTable_API', [
      { field: 'PatientNumber', value: '418612' },
      { field: 'CUID', value: 'room-cuid' },
    ]);
    expect(findByPatientNumberMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      '418612',
    );
    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'patient_not_found',
        message: 'Move-out event skipped because resident was not found in Caspio',
      }),
    );
    expect(updateRecordByIdMock).not.toHaveBeenCalled();
  });

  it('keeps the A03 patient update when no service row is found', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });

    await handleYardiHl7Event(baseInput('hl7.adt.a03', { trigger: 'A03' }));

    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      expect.objectContaining({ On_Prem: false }),
    );
    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'service_not_found' }),
    );
  });

  it('marks the patient off-prem and starts an episode for A21', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });

    await handleYardiHl7Event(baseInput('hl7.adt.a21', { trigger: 'A21' }));

    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', 'patient-1', {
      Off_Prem: true,
      On_Prem: false,
      Off_Prem_Date: '08/20/2026 14:15:16',
    });
    expect(upsertOffPremEpisodeByEpisodeIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        PatientNumber: '418612',
        CUID: 'room-cuid',
        CommunityName: 'EyeWatch Live',
        OffPremStart: '08/20/2026 14:15:16',
        IsOpen: true,
      }),
    );
  });

  it('records an issue and skips A21 when the patient is missing', async () => {
    await handleYardiHl7Event(baseInput('hl7.adt.a21', { trigger: 'A21' }));

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'patient_not_found',
      }),
    );
    expect(updateRecordByIdMock).not.toHaveBeenCalled();
    expect(upsertOffPremEpisodeByEpisodeIdMock).not.toHaveBeenCalled();
  });

  it('closes the open episode and marks the patient on-prem for A22', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });
    findOpenOffPremEpisodeMock.mockResolvedValueOnce({
      found: true,
      id: 'episode-1',
      record: {
        Episode_ID: 'leave-episode-1',
        OffPremStart: '08/20/2026 12:15:16',
      },
    });

    await handleYardiHl7Event(baseInput('hl7.adt.a22', { trigger: 'A22' }));

    expect(findOpenOffPremEpisodeMock).toHaveBeenCalledWith({
      patientNumber: '418612',
      cuid: 'room-cuid',
    });
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'PatientOffPremHistory_API',
      'episode-1',
      expect.objectContaining({
        OffPremEnd: '08/20/2026 14:15:16',
        DurationMinutes: 120,
        DurationHours: 2,
        IsOpen: false,
        CloseReason: 'leave_end',
      }),
    );
    expect(updateRecordByIdMock).toHaveBeenCalledWith('CarePatientTable_API', 'patient-1', {
      Off_Prem: false,
      On_Prem: true,
    });
  });

  it('records an issue and skips A22 when the patient is missing', async () => {
    await handleYardiHl7Event(baseInput('hl7.adt.a22', { trigger: 'A22' }));

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'patient_not_found',
      }),
    );
    expect(findOpenOffPremEpisodeMock).not.toHaveBeenCalled();
    expect(updateRecordByIdMock).not.toHaveBeenCalled();
  });

  it('marks the A22 patient on-prem when no open episode is found', async () => {
    findRecordByFieldsMock.mockResolvedValueOnce({
      found: true,
      id: 'patient-1',
      record: { PatientNumber: '418612', CUID: 'room-cuid' },
    });

    await handleYardiHl7Event(baseInput('hl7.adt.a22', { trigger: 'A22' }));

    expect(recordEventIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'open_off_prem_episode_not_found' }),
    );
    expect(updateRecordByIdMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      'patient-1',
      { Off_Prem: false, On_Prem: true },
    );
  });

  it('requires an enriched CUID before update workflow writes', async () => {
    for (const trigger of ['A02', 'A03', 'A05', 'A08', 'A21', 'A22', 'A60']) {
      jest.clearAllMocks();
      getCommunityEnrichmentMock.mockResolvedValueOnce({ CommunityName: 'EyeWatch Live' });

      await handleYardiHl7Event(
        baseInput(`hl7.adt.${trigger.toLowerCase()}`, { trigger }),
      );

      expect(recordEventIssueMock).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'missing_cuid' }),
      );
      expect(updateRecordByIdMock).not.toHaveBeenCalled();
    }
  });
});
