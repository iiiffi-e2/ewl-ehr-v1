import type { AxiosInstance } from 'axios';

import { createHttpClient } from '../../config/axios.js';
import { env } from '../../config/env.js';

import type { FhirBundle, FhirPatient, YardiFhirPatientBundle } from './yardiFhirTypes.js';

const MAX_PAGE_SIZE = 400;

export class YardiFhirClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private fhirHttp: AxiosInstance | null = null;
  private tokenRefreshPromise: Promise<void> | null = null;

  constructor(
    private readonly tokenUrl = env.YARDI_FHIR_TOKEN_URL,
    private readonly apiBaseUrl = env.YARDI_FHIR_API_BASE_URL,
    private readonly clientId = env.YARDI_FHIR_CLIENT_ID,
    private readonly clientSecret = env.YARDI_FHIR_CLIENT_SECRET,
    private readonly scope = env.YARDI_FHIR_SCOPE,
  ) {}

  static assertConfigured(): void {
    if (!env.YARDI_FHIR_TOKEN_URL || !env.YARDI_FHIR_API_BASE_URL) {
      throw new Error('Yardi FHIR is not configured in environment');
    }
  }

  static createConfigured(): YardiFhirClient {
    YardiFhirClient.assertConfigured();
    return new YardiFhirClient();
  }

  async getAuthorizedClient(): Promise<AxiosInstance> {
    await this.ensureAccessToken();
    if (!this.fhirHttp) {
      this.fhirHttp = createHttpClient({
        baseURL: this.apiBaseUrl,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/fhir+json',
        },
      });
    }
    return this.fhirHttp;
  }

  async searchBundle(path: string, params: Record<string, string | number | undefined>): Promise<FhirBundle> {
    const http = await this.getAuthorizedClient();
    const response = await http.get<FhirBundle>(path, { params: compactParams(params) });
    return response.data;
  }

  async searchAllPages(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<FhirBundle[]> {
    const pages: FhirBundle[] = [];
    let offset = 0;
    const pageSize = Math.min(Number(params._count ?? MAX_PAGE_SIZE), MAX_PAGE_SIZE);

    while (true) {
      const bundle = await this.searchBundle(path, {
        ...params,
        _count: pageSize,
        _getpagesoffset: offset,
      });
      pages.push(bundle);

      const entryCount = bundle.entry?.length ?? 0;
      const total = bundle.total ?? entryCount;
      offset += entryCount;

      if (entryCount === 0 || offset >= total) {
        break;
      }
    }

    return pages;
  }

  async readPatient(patientId: string): Promise<FhirPatient | null> {
    const http = await this.getAuthorizedClient();
    try {
      const response = await http.get<FhirPatient>(`/Patient/${encodeURIComponent(patientId)}`);
      return response.data;
    } catch {
      const bundle = await this.searchBundle('/Patient', {
        _id: patientId,
        _count: 1,
      });
      return (bundle.entry?.[0]?.resource ?? null) as FhirPatient | null;
    }
  }

  async listActivePatientIds(organizationId: string): Promise<string[]> {
    const bundles = await this.searchAllPages('/Patient', {
      organization: organizationId,
      active: 'true',
      _count: MAX_PAGE_SIZE,
    });
    return collectPatientIdsFromBundles(bundles);
  }

  async listEncounterPatientIdsSince(sinceIsoDate: string): Promise<string[]> {
    const datePrefix = sinceIsoDate.slice(0, 10);
    const bundles = await this.searchAllPages('/Encounter', {
      date: `gt${datePrefix}`,
      _count: MAX_PAGE_SIZE,
    });
    return collectPatientIdsFromEncounterBundles(bundles);
  }

  async fetchPatientBundle(patientId: string): Promise<YardiFhirPatientBundle> {
    const [patient, encounterBundle, coverageBundle, conditionBundle] = await Promise.all([
      this.readPatient(patientId),
      this.searchBundle('/Encounter', {
        patient: `Patient/${patientId}`,
        _count: 1,
        _sort: '-date',
      }),
      this.searchBundle('/Coverage', {
        patient: `Patient/${patientId}`,
        _count: 10,
      }),
      this.searchBundle('/Condition', {
        patient: `Patient/${patientId}`,
        _count: 10,
        'clinical-status': 'active',
      }),
    ]);

    return {
      patientId,
      patient,
      encounterBundle,
      coverageBundle,
      conditionBundle,
    };
  }

  private async ensureAccessToken(): Promise<void> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 30_000) {
      return;
    }

    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = this.fetchAccessToken().finally(() => {
        this.tokenRefreshPromise = null;
      });
    }

    await this.tokenRefreshPromise;
  }

  private async fetchAccessToken(): Promise<void> {
    const now = Date.now();
    if (!this.tokenUrl) {
      throw new Error('Yardi FHIR token URL is not configured');
    }

    const tokenHttp = createHttpClient({
      baseURL: this.tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth:
        this.clientId && this.clientSecret
          ? {
              username: this.clientId,
              password: this.clientSecret,
            }
          : undefined,
    });

    const tokenResponse = await tokenHttp.post(
      '',
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: this.scope,
      }).toString(),
    );

    const accessToken = (tokenResponse.data as { access_token?: string }).access_token;
    const expiresIn = Number((tokenResponse.data as { expires_in?: number }).expires_in ?? 300);

    if (!accessToken) {
      throw new Error('Yardi FHIR token response missing access_token');
    }

    this.token = accessToken;
    this.tokenExpiresAt = now + expiresIn * 1000;
    this.fhirHttp = null;
  }
}

function compactParams(
  params: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

function collectPatientIdsFromBundles(bundles: FhirBundle[]): string[] {
  const ids = new Set<string>();
  for (const bundle of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === 'Patient' && typeof resource.id === 'string') {
        ids.add(resource.id);
      }
    }
  }
  return [...ids];
}

function collectPatientIdsFromEncounterBundles(bundles: FhirBundle[]): string[] {
  const ids = new Set<string>();
  for (const bundle of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType !== 'Encounter') continue;

      const subject = resource.subject as { reference?: string } | undefined;
      const patientId = parsePatientReference(subject?.reference);
      if (patientId) {
        ids.add(patientId);
      }
    }
  }
  return [...ids];
}

export function parsePatientReference(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  const trimmed = reference.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('Patient/')) {
    return trimmed.slice('Patient/'.length);
  }
  return trimmed;
}
