import crypto from 'crypto';

import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getMasterKey(): Buffer {
  const raw = env.ALIS_CREDENTIALS_MASTER_KEY;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ALIS_CREDENTIALS_MASTER_KEY must be 32 bytes (base64-encoded).');
  }
  return key;
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: `${encrypted.toString('base64')}.${authTag.toString('base64')}`,
    iv: iv.toString('base64'),
  };
}

export function decryptSecret(ciphertextWithTag: string, ivBase64: string): string {
  const key = getMasterKey();
  const [ciphertextB64, authTagB64] = ciphertextWithTag.split('.');
  if (!ciphertextB64 || !authTagB64) {
    throw new Error('Ciphertext is missing auth tag.');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
