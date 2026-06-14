export type FhirBundleEntry = {
  resource?: Record<string, unknown>;
  fullUrl?: string;
};

export type FhirBundle = {
  resourceType?: string;
  type?: string;
  total?: number;
  link?: Array<{ relation?: string; url?: string }>;
  entry?: FhirBundleEntry[];
};

export type FhirPatient = Record<string, unknown>;

export type YardiFhirPollTarget = {
  companyKey: string;
  communityId: number;
  organizationId: string;
};

export type YardiFhirPatientBundle = {
  patientId: string;
  patient: FhirPatient | null;
  encounterBundle: FhirBundle;
  coverageBundle: FhirBundle;
  conditionBundle: FhirBundle;
};

export type YardiFhirSyncSummary = {
  companyKey: string;
  communityId: number;
  organizationId: string;
  startedAt: string;
  completedAt: string;
  sinceDate?: string;
  patientsDiscovered: number;
  patientsProcessed: number;
  patientsSucceeded: number;
  patientsFailed: number;
  errors: Array<{ patientId: string; message: string }>;
  patientDetails?: YardiFhirSyncPatientDetail[];
};

export type YardiFhirPulledData = {
  patientId: string;
  externalResidentId: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  status: string | null;
  roomNumber: string | null;
  bed: string | null;
  productType: string | null;
  onPrem: boolean | null;
  onPremDate: string | null;
  offPrem: boolean | null;
  offPremDate: string | null;
  coverage: string[];
  conditions: string[];
  encounterCount: number;
};

export type YardiFhirCaspioPushPlan = {
  skipped: boolean;
  skipReason?: string;
  tables: {
    patient: string;
    community: string;
    service: string;
  };
  patientRecord?: Record<string, unknown>;
  communityRecord?: Record<string, unknown>;
  serviceRecord?: Record<string, unknown>;
  pushError?: string;
};

export type YardiFhirSyncPatientDetail = {
  patientId: string;
  status: 'succeeded' | 'failed';
  yardi?: YardiFhirPulledData;
  caspio?: YardiFhirCaspioPushPlan;
  error?: string;
};
