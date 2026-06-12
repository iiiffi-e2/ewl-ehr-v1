import axios from 'axios';

import { createHttpClient } from '../config/axios.js';
import { env } from '../config/env.js';
import { YardiFhirClient } from '../integrations/yardi/yardiFhirClient.js';
import { parseYardiFhirPollTargets } from '../integrations/yardi/yardiFhirPollConfig.js';
import type { YardiFhirPollTarget } from '../integrations/yardi/yardiFhirTypes.js';

export type YardiFhirTestConfig = {
  configured: boolean;
  tokenUrl: string | null;
  apiBaseUrl: string | null;
  scope: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  pollEnabled: boolean;
  pollIntervalMs: number;
  pollTargets: YardiFhirPollTarget[];
};

export type YardiFhirAuthTestResult = {
  success: true;
  tokenUrl: string;
  scope: string;
  status: number;
  durationMs: number;
  response: Record<string, unknown>;
};

export type YardiFhirRequestTestResult = {
  success: boolean;
  method: 'GET';
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  responseHeaders: Record<string, string>;
  data: unknown;
  error?: string;
};

function getPollTargetsSafe(): YardiFhirPollTarget[] {
  try {
    return parseYardiFhirPollTargets(env.YARDI_FHIR_POLL_TARGETS);
  } catch {
    return [];
  }
}

export function getYardiFhirTestConfig(): YardiFhirTestConfig {
  return {
    configured: Boolean(env.YARDI_FHIR_TOKEN_URL && env.YARDI_FHIR_API_BASE_URL),
    tokenUrl: env.YARDI_FHIR_TOKEN_URL ?? null,
    apiBaseUrl: env.YARDI_FHIR_API_BASE_URL ?? null,
    scope: env.YARDI_FHIR_SCOPE,
    hasClientId: Boolean(env.YARDI_FHIR_CLIENT_ID),
    hasClientSecret: Boolean(env.YARDI_FHIR_CLIENT_SECRET),
    pollEnabled: env.YARDI_FHIR_POLL_ENABLED,
    pollIntervalMs: env.YARDI_FHIR_POLL_INTERVAL_MS,
    pollTargets: getPollTargetsSafe(),
  };
}

export async function testYardiFhirAuthentication(): Promise<YardiFhirAuthTestResult> {
  if (!env.YARDI_FHIR_TOKEN_URL) {
    throw new Error('YARDI_FHIR_TOKEN_URL is not configured');
  }
  if (!env.YARDI_FHIR_CLIENT_ID || !env.YARDI_FHIR_CLIENT_SECRET) {
    throw new Error('YARDI_FHIR_CLIENT_ID and YARDI_FHIR_CLIENT_SECRET must be configured');
  }

  const started = Date.now();
  const tokenHttp = createHttpClient({
    baseURL: env.YARDI_FHIR_TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    auth: {
      username: env.YARDI_FHIR_CLIENT_ID,
      password: env.YARDI_FHIR_CLIENT_SECRET,
    },
  });

  const tokenResponse = await tokenHttp.post(
    '',
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: env.YARDI_FHIR_SCOPE,
    }).toString(),
  );

  return {
    success: true,
    tokenUrl: env.YARDI_FHIR_TOKEN_URL,
    scope: env.YARDI_FHIR_SCOPE,
    status: tokenResponse.status,
    durationMs: Date.now() - started,
    response:
      tokenResponse.data && typeof tokenResponse.data === 'object'
        ? (tokenResponse.data as Record<string, unknown>)
        : { raw: tokenResponse.data },
  };
}

export function validateYardiFhirPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    throw new Error('Path must start with /');
  }
  if (trimmed.includes('..')) {
    throw new Error('Path must not contain ..');
  }
  if (!/^\/[A-Za-z0-9/_:@.-]*$/.test(trimmed)) {
    throw new Error('Path contains invalid characters');
  }
  return trimmed;
}

export function normalizeQueryParams(
  params: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!params || typeof params !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

export async function executeYardiFhirGetRequest(
  path: string,
  params: Record<string, unknown> | undefined,
): Promise<YardiFhirRequestTestResult> {
  YardiFhirClient.assertConfigured();
  const normalizedPath = validateYardiFhirPath(path);
  const queryParams = normalizeQueryParams(params);
  const client = YardiFhirClient.createConfigured();
  const http = await client.getAuthorizedClient();
  const started = Date.now();

  try {
    const response = await http.get(normalizedPath, { params: queryParams });
    const requestUrl = buildRequestUrl(env.YARDI_FHIR_API_BASE_URL!, normalizedPath, queryParams);

    return {
      success: true,
      method: 'GET',
      url: requestUrl,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - started,
      responseHeaders: flattenHeaders(response.headers),
      data: response.data,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const requestUrl = buildRequestUrl(
        env.YARDI_FHIR_API_BASE_URL!,
        normalizedPath,
        queryParams,
      );
      return {
        success: false,
        method: 'GET',
        url: requestUrl,
        status: error.response.status,
        statusText: error.response.statusText,
        durationMs: Date.now() - started,
        responseHeaders: flattenHeaders(error.response.headers),
        data: error.response.data,
        error: error.message,
      };
    }
    throw error;
  }
}

function buildRequestUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function flattenHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.map(String).join(', ');
    }
  }
  return result;
}
