import { PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

type LogLevel = 'info' | 'query' | 'warn' | 'error';

const prismaLogLevels: LogLevel[] =
  env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'];

class PrismaSingleton {
  private static instance: PrismaClient | null = null;

  static getInstance(): PrismaClient {
    if (!PrismaSingleton.instance) {
      PrismaSingleton.instance = new PrismaClient({
        log: prismaLogLevels,
        datasources: {
          db: {
            url: env.DATABASE_URL,
          },
        },
      });
    }

    return PrismaSingleton.instance;
  }
}

export const prisma = PrismaSingleton.getInstance();

export async function disconnectPrisma(): Promise<void> {
  if (PrismaSingleton['instance']) {
    await PrismaSingleton['instance']?.$disconnect();
  }
}
