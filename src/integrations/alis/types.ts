import type {
  AlisContact,
  AlisDiagnosisOrAllergy,
  AlisInsurance,
  AlisResidentBasicInfo,
  AlisResidentDetail,
  AlisRoomAssignment,
} from '../alisClient.js';

/**
 * ALIS payload structure matching the enriched data format
 * after fetching from ALIS API
 */
export type AlisPayload = {
  success: boolean;
  residentId: number;
  timestamp: string;
  apiBase: string;
  data: {
    resident: AlisResidentDetail;
    basicInfo: AlisResidentBasicInfo;
    insurance: AlisInsurance[];
    roomAssignments: AlisRoomAssignment[];
    diagnosesAndAllergies: AlisDiagnosisOrAllergy[];
    contacts: AlisContact[];
  };
  counts: {
    insurance: number;
    roomAssignments: number;
    diagnosesAndAllergies: number;
    contacts: number;
  };
};

