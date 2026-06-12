import type { EhrSource } from '../integrations/ehr/types.js';

export type ProcessAlisEventJobData = {
  source: EhrSource;
  eventMessageId: string;
  eventType: string;
  companyKey: string;
  companyId: number;
  communityId: number | null;
  notificationData?: Record<string, unknown>;
  eventMessageDate: string;
};

export type ResidentBackfillJobData = {
  companyKey: string;
  communityId: number;
  status: string;
  pageSize?: number;
};

export type YardiFhirPollJobData = {
  companyKey?: string;
  communityId?: number;
  organizationId?: string;
  skipCaspio?: boolean;
};
