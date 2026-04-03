import type { AlisEvent } from '../../webhook/schemas.js';

export type EhrSource = 'alis' | 'yardi-fhir' | 'yardi-hl7';

export type EhrLifecycleKind =
  | 'created'
  | 'move_in'
  | 'move_out'
  | 'leave_start'
  | 'leave_end'
  | 'leave_cancelled'
  | 'update'
  | 'contact'
  | 'unknown';

export type CanonicalInboundEvent = {
  source: EhrSource;
  companyKey: string;
  communityId: number | null;
  eventType: string;
  eventMessageId: string;
  eventMessageDate: string;
  lifecycleKind: EhrLifecycleKind;
  notificationData: Record<string, unknown>;
  raw: unknown;
};

export type CanonicalResidentDemographics = {
  externalResidentId: string;
  status?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  roomNumber?: string | null;
  bed?: string | null;
  room?: string | null;
  productType?: string | null;
  classification?: string | null;
  onPrem?: boolean | null;
  onPremDate?: string | null;
  offPrem?: boolean | null;
  offPremDate?: string | null;
  updatedAtUtc?: string | null;
};

export type CanonicalResidentBundle = {
  source: EhrSource;
  companyKey: string;
  companyId: number;
  communityId: number | null;
  residentId: number;
  event: CanonicalInboundEvent;
  demographics: CanonicalResidentDemographics;
  /**
   * Adapter-specific payload used by legacy downstream flow.
   * ALIS keeps current shape to avoid behavior changes while adapters are introduced.
   */
  vendorPayload?: unknown;
  raw?: unknown;
};

export type CanonicalEventOrchestrationInput = {
  source: EhrSource;
  companyId: number;
  companyKey: string;
  event: CanonicalInboundEvent;
  residentBundle?: CanonicalResidentBundle;
  legacyAlisEvent?: AlisEvent;
};
