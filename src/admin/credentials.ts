import { prisma } from '../db/prisma.js';
import { encryptSecret } from '../security/credentials.js';

export type UpsertAlisCredentialInput = {
  companyKey: string;
  username: string;
  password: string;
};

export async function upsertAlisCredential(
  input: UpsertAlisCredentialInput,
): Promise<{ companyId: number; username: string }> {
  const company = await prisma.company.findUnique({
    where: { companyKey: input.companyKey },
  });

  if (!company) {
    throw new Error(`Company not found for key '${input.companyKey}'.`);
  }

  const encrypted = encryptSecret(input.password);

  const record = await prisma.alisCredential.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      username: input.username,
      passwordCiphertext: encrypted.ciphertext,
      passwordIv: encrypted.iv,
    },
    update: {
      username: input.username,
      passwordCiphertext: encrypted.ciphertext,
      passwordIv: encrypted.iv,
    },
  });

  return { companyId: record.companyId, username: record.username };
}
