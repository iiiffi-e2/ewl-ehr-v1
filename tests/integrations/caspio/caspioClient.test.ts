import axios from 'axios';

import {
  caspioRequestWithRetry,
  findByResidentId,
  getAccessToken,
  insertRecord,
  updateRecordById,
  upsertByResidentId,
} from '../../../src/integrations/caspio/caspioClient.js';
import { env } from '../../../src/config/env.js';

// Mock axios and HTTP clients
jest.mock('axios');
jest.mock('../../../src/config/axios.js', () => ({
  createHttpClient: jest.fn(() => ({
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    request: jest.fn(),
  })),
}));

jest.mock('../../../src/config/env.js', () => ({
  env: {
    CASPIO_BASE_URL: 'https://c3aca270.caspio.com',
    CASPIO_TOKEN_URL: 'https://c3aca270.caspio.com/oauth/token',
    CASPIO_CLIENT_ID: 'test-client-id',
    CASPIO_CLIENT_SECRET: 'test-client-secret',
    CASPIO_TABLE_NAME: 'AlisAPITestTable',
    CASPIO_TIMEOUT_MS: 10000,
    CASPIO_RETRY_MAX: 3,
  },
}));

jest.mock('../../../src/config/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe('caspioClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getAccessToken', () => {
    it('fetches new token when cache is empty', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          access_token: 'test-token-123',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        post: mockPost,
      });

      // Clear module cache to get fresh instance
      jest.resetModules();
      const { getAccessToken: getToken } = await import('../../../src/integrations/caspio/caspioClient.js');

      const token = await getToken();
      expect(token).toBe('test-token-123');
      expect(mockPost).toHaveBeenCalled();
    });

    it('returns cached token if still valid (more than 60s remaining)', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          access_token: 'test-token-123',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        post: mockPost,
      });

      jest.resetModules();
      const { getAccessToken: getToken } = await import('../../../src/integrations/caspio/caspioClient.js');

      // First call - fetches token
      const token1 = await getToken();
      expect(mockPost).toHaveBeenCalledTimes(1);

      // Advance time by 30 minutes (1800s) - still valid (3600s - 60s buffer = 3540s)
      jest.advanceTimersByTime(30 * 60 * 1000);

      // Second call - uses cache
      const token2 = await getToken();
      expect(token2).toBe('test-token-123');
      expect(mockPost).toHaveBeenCalledTimes(1); // Still only called once
    });

    it('refreshes token if less than 60s remaining', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          access_token: 'test-token-123',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        post: mockPost,
      });

      jest.resetModules();
      const { getAccessToken: getToken } = await import('../../../src/integrations/caspio/caspioClient.js');

      // First call - fetches token
      await getToken();
      expect(mockPost).toHaveBeenCalledTimes(1);

      // Advance time to just before refresh threshold (3540s = 3600s - 60s)
      jest.advanceTimersByTime(3540 * 1000);

      // Second call - should refresh
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: 'test-token-456',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });

      const token2 = await getToken();
      expect(token2).toBe('test-token-456');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('throws error if CLIENT_ID or CLIENT_SECRET missing', async () => {
      const originalEnv = { ...env };
      delete (env as any).CASPIO_CLIENT_ID;

      jest.resetModules();
      const { getAccessToken: getToken } = await import('../../../src/integrations/caspio/caspioClient.js');

      await expect(getToken()).rejects.toThrow('CASPIO_CLIENT_ID and CASPIO_CLIENT_SECRET must be set');

      // Restore
      Object.assign(env, originalEnv);
    });
  });

  describe('findByResidentId', () => {
    it('returns found: false when no records match', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        data: [],
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        get: mockGet,
        post: jest.fn(),
      });

      jest.resetModules();
      const { findByResidentId: findById } = await import('../../../src/integrations/caspio/caspioClient.js');

      const result = await findById('AlisAPITestTable', '12345');
      expect(result.found).toBe(false);
    });

    it('returns found: true with ID when record exists', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        data: [
          {
            PK: 'caspio-record-id-123',
            Resident_ID: '12345',
            Resident_Name: 'John Doe',
          },
        ],
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        get: mockGet,
        post: jest.fn(),
      });

      jest.resetModules();
      const { findByResidentId: findById } = await import('../../../src/integrations/caspio/caspioClient.js');

      const result = await findById('AlisAPITestTable', '12345');
      expect(result.found).toBe(true);
      expect(result.id).toBe('caspio-record-id-123');
      expect(result.matches).toBe(1);
    });

    it('handles multiple matches and logs warning', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        data: [
          { PK: 'id1', Resident_ID: '12345' },
          { PK: 'id2', Resident_ID: '12345' },
        ],
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      const { logger } = require('../../../src/config/logger.js');
      createHttpClient.mockReturnValue({
        get: mockGet,
        post: jest.fn(),
      });

      jest.resetModules();
      const { findByResidentId: findById } = await import('../../../src/integrations/caspio/caspioClient.js');

      const result = await findById('AlisAPITestTable', '12345');
      expect(result.found).toBe(true);
      expect(result.matches).toBe(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          residentId: '12345',
          matchCount: 2,
        }),
        'caspio_multiple_matches_found',
      );
    });

    it('handles 404 as not found', async () => {
      const axiosError = new Error('Not Found') as any;
      axiosError.response = { status: 404 };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockGet = jest.fn().mockRejectedValue(axiosError);

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        get: mockGet,
        post: jest.fn(),
      });

      jest.resetModules();
      const { findByResidentId: findById } = await import('../../../src/integrations/caspio/caspioClient.js');

      const result = await findById('AlisAPITestTable', '12345');
      expect(result.found).toBe(false);
    });
  });

  describe('upsertByResidentId', () => {
    it('updates existing record when found', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        data: [{ PK: 'caspio-id-123', Resident_ID: '12345' }],
      });
      const mockPut = jest.fn().mockResolvedValue({ data: {} });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        get: mockGet,
        put: mockPut,
        post: jest.fn(),
      });

      jest.resetModules();
      const { upsertByResidentId: upsert } = await import('../../../src/integrations/caspio/caspioClient.js');

      const record = { Resident_ID: '12345', Resident_Name: 'John Doe' };
      const result = await upsert('AlisAPITestTable', '12345', record);

      expect(result.action).toBe('update');
      expect(result.id).toBe('caspio-id-123');
      expect(mockPut).toHaveBeenCalled();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('inserts new record when not found', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const mockPost = jest.fn().mockResolvedValue({
        data: { PK: 'new-caspio-id-456' },
      });

      const { createHttpClient } = require('../../../src/config/axios.js');
      createHttpClient.mockReturnValue({
        get: mockGet,
        post: mockPost,
        put: jest.fn(),
      });

      jest.resetModules();
      const { upsertByResidentId: upsert } = await import('../../../src/integrations/caspio/caspioClient.js');

      const record = { Resident_ID: '12345', Resident_Name: 'John Doe' };
      const result = await upsert('AlisAPITestTable', '12345', record);

      expect(result.action).toBe('insert');
      expect(result.id).toBe('new-caspio-id-456');
      expect(mockPost).toHaveBeenCalled();
    });
  });


  describe('retry logic', () => {
    it('retries on 429 status', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 429 },
          isAxiosError: true,
        })
        .mockResolvedValueOnce({ data: 'success' });

      axios.isAxiosError = jest.fn().mockReturnValue(true);

      jest.resetModules();
      const { caspioRequestWithRetry: withRetry } = await import(
        '../../../src/integrations/caspio/caspioClient.js'
      );

      const result = await withRetry(mockOperation);
      expect(result).toEqual({ data: 'success' });
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 status', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 500 },
          isAxiosError: true,
        })
        .mockResolvedValueOnce({ data: 'success' });

      axios.isAxiosError = jest.fn().mockReturnValue(true);

      jest.resetModules();
      const { caspioRequestWithRetry: withRetry } = await import(
        '../../../src/integrations/caspio/caspioClient.js'
      );

      const result = await withRetry(mockOperation);
      expect(result).toEqual({ data: 'success' });
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('retries on timeout', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce({
          code: 'ECONNABORTED',
          isAxiosError: true,
        })
        .mockResolvedValueOnce({ data: 'success' });

      axios.isAxiosError = jest.fn().mockReturnValue(true);

      jest.resetModules();
      const { caspioRequestWithRetry: withRetry } = await import(
        '../../../src/integrations/caspio/caspioClient.js'
      );

      const result = await withRetry(mockOperation);
      expect(result).toEqual({ data: 'success' });
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('stops retrying after max attempts', async () => {
      const mockOperation = jest.fn().mockRejectedValue({
        response: { status: 500 },
        isAxiosError: true,
      });

      axios.isAxiosError = jest.fn().mockReturnValue(true);

      jest.resetModules();
      const { caspioRequestWithRetry: withRetry } = await import(
        '../../../src/integrations/caspio/caspioClient.js'
      );

      await expect(withRetry(mockOperation)).rejects.toBeDefined();
      expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('handles 401 with single token refresh and retry', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 401 },
          isAxiosError: true,
        })
        .mockResolvedValueOnce({ data: 'success' });

      axios.isAxiosError = jest.fn().mockReturnValue(true);

      jest.resetModules();
      const { caspioRequestWithRetry: withRetry } = await import(
        '../../../src/integrations/caspio/caspioClient.js'
      );

      const result = await withRetry(mockOperation);
      expect(result).toEqual({ data: 'success' });
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });
  });
});

