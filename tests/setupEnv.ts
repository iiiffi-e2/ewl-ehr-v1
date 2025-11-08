process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '0';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.ENABLE_SWAGGER = process.env.ENABLE_SWAGGER ?? 'false';
process.env.IP_ALLOWLIST = process.env.IP_ALLOWLIST ?? '';
process.env.WORKER_CONCURRENCY = process.env.WORKER_CONCURRENCY ?? '1';
process.env.REQUEST_TIMEOUT_MS = process.env.REQUEST_TIMEOUT_MS ?? '5000';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./test.db';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

process.env.ALIS_API_BASE = process.env.ALIS_API_BASE ?? 'https://api.alisonline.com';
process.env.ALIS_TEST_USERNAME =
  process.env.ALIS_TEST_USERNAME ?? 'eye-watch-live@appstoresandbox';
process.env.ALIS_TEST_PASSWORD =
  process.env.ALIS_TEST_PASSWORD ?? '5z65rGwpY308kAB';

process.env.WEBHOOK_BASIC_USER = process.env.WEBHOOK_BASIC_USER ?? 'test-user';
process.env.WEBHOOK_BASIC_PASS = process.env.WEBHOOK_BASIC_PASS ?? 'test-pass';

process.env.CASPIO_TOKEN_URL =
  process.env.CASPIO_TOKEN_URL ?? 'https://example.caspio.com/oauth/token';
process.env.CASPIO_CLIENT_ID = process.env.CASPIO_CLIENT_ID ?? 'client-id';
process.env.CASPIO_CLIENT_SECRET = process.env.CASPIO_CLIENT_SECRET ?? 'client-secret';
process.env.CASPIO_TABLE_ENDPOINT =
  process.env.CASPIO_TABLE_ENDPOINT ??
  'https://example.caspio.com/rest/v2/tables/test/rows';
process.env.CASPIO_SCOPE = process.env.CASPIO_SCOPE ?? 'resources:all';
