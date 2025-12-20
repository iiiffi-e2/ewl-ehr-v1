import type {
  AlisCommunity,
  AlisContact,
  AlisDiagnosesAndAllergies,
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
    diagnosesAndAllergiesFull?: AlisDiagnosesAndAllergies | null;
    contacts: AlisContact[];
    community?: AlisCommunity | null;
  };
  counts: {
    insurance: number;
    roomAssignments: number;
    diagnosesAndAllergies: number;
    contacts: number;
  };
};


