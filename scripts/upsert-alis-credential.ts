import 'dotenv/config';

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

function readArg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    return process.argv[index + 1];
  }
  const prefixed = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) {
    return prefixed.slice(flag.length + 1);
  }
  return undefined;
}

async function main(): Promise<void> {
  const companyKey = readArg('companyKey');
  const username = readArg('username');
  const password = readArg('password');

  if (!companyKey || !username || !password) {
    throw new Error('Usage: --companyKey <key> --username <user> --password <pass>');
  }

  const masterKey = process.env.ALIS_CREDENTIALS_MASTER_KEY;
  if (!masterKey) {
    throw new Error('ALIS_CREDENTIALS_MASTER_KEY is required.');
  }

  const key = Buffer.from(masterKey, 'base64');
  if (key.length !== 32) {
    throw new Error('ALIS_CREDENTIALS_MASTER_KEY must be 32 bytes (base64-encoded).');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = `${encrypted.toString('base64')}.${authTag.toString('base64')}`;

  let prisma: PrismaClient | null = null;
  try {
    prisma = new PrismaClient();
    const company = await prisma.company.findUnique({
      where: { companyKey },
    });

    if (!company) {
      throw new Error(`Company not found for key '${companyKey}'.`);
    }

    const record = await prisma.alisCredential.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        username,
        passwordCiphertext: ciphertext,
        passwordIv: iv.toString('base64'),
      },
      update: {
        username,
        passwordCiphertext: ciphertext,
        passwordIv: iv.toString('base64'),
      },
    });

    console.log(
      JSON.stringify(
        {
          success: true,
          companyId: record.companyId,
          username: record.username,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma?.$disconnect();
  }

  return;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => undefined);
