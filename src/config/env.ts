import 'dotenv/config';

import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(8080),
    LOG_LEVEL: z.string().default('info'),
    ENABLE_SWAGGER: z
      .union([z.string(), z.boolean()])
      .default('true')
      .transform((val) => {
        if (typeof val === 'boolean') return val;
        return val.toLowerCase() === 'true';
      }),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    ALIS_API_BASE: z.string().url(),
    ALIS_TEST_USERNAME: z.string(),
    ALIS_TEST_PASSWORD: z.string(),
    WEBHOOK_BASIC_USER: z.string(),
    WEBHOOK_BASIC_PASS: z.string(),
    CASPIO_TOKEN_URL: z.string().url(),
    CASPIO_CLIENT_ID: z.string(),
    CASPIO_CLIENT_SECRET: z.string(),
    CASPIO_TABLE_ENDPOINT: z.string().url(),
    CASPIO_SCOPE: z.string().default('resources:all'),
    IP_ALLOWLIST: z.string().optional(),
    WORKER_CONCURRENCY: z.coerce.number().default(5),
    REQUEST_TIMEOUT_MS: z.coerce.number().default(15000),
  })
  .transform((values) => ({
    ...values,
    ipAllowlist: values.IP_ALLOWLIST
      ? values.IP_ALLOWLIST.split(',').map((ip) => ip.trim()).filter(Boolean)
      : [],
  }));

export const env = EnvSchema.parse(process.env);

export type AppEnv = typeof env;
