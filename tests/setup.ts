import { afterAll, beforeEach } from '@jest/globals';

import { prisma } from '../src/db/prisma.js';

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});
