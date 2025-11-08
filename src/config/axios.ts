import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

import { env } from './env.js';
import { logger } from './logger.js';

export function createHttpClient(config: AxiosRequestConfig = {}): AxiosInstance {
  const instance = axios.create({
    timeout: env.REQUEST_TIMEOUT_MS,
    ...config,
  });

  instance.interceptors.request.use((request) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        service: config.baseURL,
      },
      'http_request',
    );
    return request;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        logger.warn(
          {
            status: error.response.status,
            data: redactPayload(error.response.data),
            url: error.config?.url,
            method: error.config?.method,
          },
          'http_error_response',
        );
      } else {
        logger.error(
          {
            message: error.message,
            url: error.config?.url,
            method: error.config?.method,
          },
          'http_error_network',
        );
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

function redactPayload(payload: unknown): unknown {
  if (!payload) return payload;
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
