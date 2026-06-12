import type { CanonicalInboundEvent, CanonicalResidentBundle, EhrSource } from './types.js';

export type ResolveResidentIdArgs = {
  event: CanonicalInboundEvent;
};

export type FetchResidentBundleArgs = {
  companyId: number;
  companyKey: string;
  event: CanonicalInboundEvent;
  residentId: number | string;
  patientId?: string;
};

export type ResolveResidentIdResult = {
  externalPatientId: string;
  numericResidentId: number | null;
};

export interface EhrAdapter {
  readonly source: EhrSource;
  parseInboundEvent(payload: unknown): CanonicalInboundEvent;
  supportsEventType(eventType: string): boolean;
  requiresResidentFetch(eventType: string): boolean;
  resolveResidentId(args: ResolveResidentIdArgs): number | string;
  resolvePatientIdentity?(args: ResolveResidentIdArgs): ResolveResidentIdResult;
  fetchResidentBundle(args: FetchResidentBundleArgs): Promise<CanonicalResidentBundle>;
}
