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
  patientsDiscovered: number;
  patientsProcessed: number;
  patientsSucceeded: number;
  patientsFailed: number;
  errors: Array<{ patientId: string; message: string }>;
};
