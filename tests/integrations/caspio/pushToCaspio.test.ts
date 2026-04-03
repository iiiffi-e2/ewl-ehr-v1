const upsertByFieldsMock = jest.fn();
const caspioRequestWithRetryMock = jest.fn(async (operation: () => Promise<unknown>) => operation());
const getCommunityEnrichmentMock = jest.fn();

jest.mock('../../../src/integrations/caspio/caspioClient.js', () => ({
  upsertByFields: upsertByFieldsMock,
  caspioRequestWithRetry: caspioRequestWithRetryMock,
}));

jest.mock('../../../src/integrations/caspio/caspioCommunityEnrichment.js', () => ({
  getCommunityEnrichment: getCommunityEnrichmentMock,
}));

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_BASE_URL: 'https://c3aca270.caspio.com',
    CASPIO_TABLE_NAME: 'CarePatientTable_API',
    CASPIO_COMMUNITY_TABLE_NAME: 'CommunityTable_API',
    CASPIO_SERVICE_TABLE_NAME: 'Service_Table_API',
  },
}));

jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { pushToCaspio } from '../../../src/integrations/caspio/pushToCaspio.js';
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
        Classification: 'Assisted Living',
        PhysicalMoveInDate: '2024-01-01T00:00:00Z',
      },
      basicInfo: {
        ResidentId: 12345,
        ProductType: 'Assisted Living',
      },
      insurance: [],
      roomAssignments: [{ RoomNumber: '101', IsPrimary: true }],
      diagnosesAndAllergies: [],
      contacts: [],
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
      insurance: 0,
      roomAssignments: 1,
      diagnosesAndAllergies: 0,
      contacts: 0,
    },
  };
}

describe('pushToCaspio new-table routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCommunityEnrichmentMock.mockResolvedValue({
      CUID: '259',
      CommunityName: 'Sunset Manor',
    });
    upsertByFieldsMock.mockResolvedValue({ action: 'update', id: 'id-1' });
  });

  it('resolves community CUID and uses it in patient/service writes', async () => {
    await pushToCaspio(buildPayload());

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CommunityTable_API',
      [{ field: 'CommunityID', value: '113' }],
      expect.objectContaining({
        CommunityID: '113',
      }),
    );

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      [
        { field: 'PatientNumber', value: '12345' },
        { field: 'CUID', value: '259' },
      ],
      expect.objectContaining({
        PatientNumber: '12345',
        CUID: '259',
      }),
    );

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'Service_Table_API',
      [{ field: 'Service_ID', value: expect.any(String) }],
      expect.objectContaining({
        PatientNumber: '12345',
        CUID: '259',
        CommunityName: 'Sunset Manor',
      }),
    );
  });

  it('skips service upsert when requested while still writing community/patient', async () => {
    await pushToCaspio(buildPayload(), { skipServiceUpsert: true });

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CommunityTable_API',
      [{ field: 'CommunityID', value: '113' }],
      expect.objectContaining({
        CommunityID: '113',
      }),
    );

    expect(upsertByFieldsMock).toHaveBeenCalledWith(
      'CarePatientTable_API',
      [
        { field: 'PatientNumber', value: '12345' },
        { field: 'CUID', value: '259' },
      ],
      expect.objectContaining({
        PatientNumber: '12345',
        CUID: '259',
      }),
    );

    expect(upsertByFieldsMock).not.toHaveBeenCalledWith(
      'Service_Table_API',
      expect.anything(),
      expect.anything(),
    );
  });
});
