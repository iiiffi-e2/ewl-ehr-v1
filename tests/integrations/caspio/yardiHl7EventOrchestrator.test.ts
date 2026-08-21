const getCommunityEnrichmentMock = jest.fn();
const upsertByFieldsMock = jest.fn();
const updateRecordByIdMock = jest.fn();
const findRecordByFieldsMock = jest.fn();
const findByPatientNumberMock = jest.fn();
const findActiveOrLatestServiceRowMock = jest.fn();
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
});
