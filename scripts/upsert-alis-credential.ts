import 'dotenv/config';

import { upsertAlisCredential } from '../src/admin/credentials.js';
import { disconnectPrisma } from '../src/db/prisma.js';

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

  const result = await upsertAlisCredential({
    companyKey,
    username,
    password,
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        companyId: result.companyId,
        username: result.username,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
