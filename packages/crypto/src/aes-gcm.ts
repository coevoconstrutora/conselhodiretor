import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Criptografia em repouso de dados sensíveis (saúde/PII) — NFR9.
 *
 * AES-256-GCM (autenticado): cada campo é cifrado com IV aleatório de 12 bytes,
 * e o payload persistido é `base64(iv ‖ authTag ‖ ciphertext)`. GCM garante
 * confidencialidade + integridade (tamper-evident): qualquer alteração no
 * ciphertext/tag faz a decifragem falhar.
 *
 * A chave (32 bytes) NUNCA é versionada — vem de `DATA_ENCRYPTION_KEY` (base64).
 * Em produção, deve ser provida por um KMS/secret manager (ver Story 1.8 / deploy).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function encryptField(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Chave inválida: esperado ${KEY_BYTES} bytes, recebido ${key.length}.`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptField(payload: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Chave inválida: esperado ${KEY_BYTES} bytes, recebido ${key.length}.`);
  }
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, IV_BYTES);
  const authTag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Carrega a chave de criptografia do ambiente (`DATA_ENCRYPTION_KEY`, base64 de 32 bytes).
 * Falha cedo e de forma clara se ausente ou com tamanho inválido.
 */
export function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = env.DATA_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error('DATA_ENCRYPTION_KEY ausente — configure uma chave base64 de 32 bytes.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `DATA_ENCRYPTION_KEY inválida: decodificada para ${key.length} bytes, esperado ${KEY_BYTES}.`,
    );
  }
  return key;
}

/** Gera uma chave AES-256 nova (utilitário para setup/rotação). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
