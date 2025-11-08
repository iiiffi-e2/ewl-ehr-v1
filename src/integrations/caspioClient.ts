import axios, { type AxiosResponse, type Method } from 'axios';

import { createHttpClient } from '../config/axios.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

import type { CaspioResidentPayload } from './mappers.js';

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

const MAX_RETRIES = 3;

let tokenCache: TokenCache | null = null;

const authClient = createHttpClient();
const apiClient = createHttpClient();

export async function sendResidentToCaspio(payload: CaspioResidentPayload): Promise<void> {
  const query = encodeURIComponent(
    JSON.stringify({
      companyKey: payload.companyKey,
      alisResidentId: payload.alisResidentId,
    }),
  );

  const exists = await withRetry(async () => await recordExists(query));

  if (exists) {
    await withRetry(async () => {
      const response = await caspioRequest(
        'put',
        `${env.CASPIO_TABLE_ENDPOINT}?q=${query}`,
        [payload],
      );

      logger.info(
        {
          eventMessageId: payload.eventMessageId,
          companyKey: payload.companyKey,
        },
        'caspio_resident_updated',
      );

      return response;
    });
    return;
  }

  await withRetry(async () => {
    const response = await caspioRequest('post', env.CASPIO_TABLE_ENDPOINT, [payload]);
    logger.info(
      {
        eventMessageId: payload.eventMessageId,
        companyKey: payload.companyKey,
      },
      'caspio_resident_created',
    );
    return response;
  });
}

async function recordExists(query: string): Promise<boolean> {
  try {
    const response = await caspioRequest(
      'get',
      `${env.CASPIO_TABLE_ENDPOINT}?q=${query}&limit=1`,
    );
    const data = response.data as { Result?: unknown[] };
    if (Array.isArray(data?.Result)) {
      return data.Result.length > 0;
    }
    if (Array.isArray(response.data)) {
      return response.data.length > 0;
    }
    return Boolean(response.data);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function caspioRequest(
  method: Method,
  url: string,
  data?: unknown,
  retryOnAuthError = true,
): Promise<AxiosResponse> {
  try {
    const token = await getAccessToken();
    return await apiClient.request({
      method,
      url,
      data,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    if (retryOnAuthError && isUnauthorized(error)) {
      logger.warn({ message: 'Caspio token expired, refreshing' }, 'caspio_token_refresh');
      invalidateToken();
      return caspioRequest(method, url, data, false);
    }

    throw error;
  }
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.CASPIO_CLIENT_ID,
    client_secret: env.CASPIO_CLIENT_SECRET,
    scope: env.CASPIO_SCOPE,
  });

  try {
    const response = await authClient.post<{
      access_token: string;
      expires_in: number;
      token_type: string;
    }>(env.CASPIO_TOKEN_URL, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const expiresIn = response.data.expires_in ?? 3600;
    tokenCache = {
      accessToken: response.data.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };

    return tokenCache.accessToken;
  } catch (error) {
    throw mapCaspioError(error, 'token');
  }
}

function invalidateToken(): void {
  tokenCache = null;
}

async function withRetry<T>(operation: () => Promise<T>, attempt = 1): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (attempt >= MAX_RETRIES || !shouldRetry(error)) {
      throw mapCaspioError(error, 'request');
    }

    const delay = Math.pow(2, attempt - 1) * 1000;
    await wait(delay);
    return withRetry(operation, attempt + 1);
  }
}

function shouldRetry(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    return status === 429 || status >= 500;
  }
  return false;
}

function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapCaspioError(error: unknown, stage: 'token' | 'request'): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.error_description ?? error.message;
    logger.error(
      {
        status,
        stage,
        message,
      },
      'caspio_api_error',
    );
    return new Error(`Caspio API ${stage} error: ${message}`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`Unknown Caspio API ${stage} error`);
}
