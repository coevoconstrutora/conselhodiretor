import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hash de senha com scrypt (node:crypto), salt aleatório de 16 bytes.
 * Formato persistido: `scrypt$<saltB64>$<hashB64>`. Comparação em tempo constante.
 * A senha em claro nunca é armazenada nem logada.
 */
const KEY_LENGTH = 64;
const PREFIX = 'scrypt';

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEY_LENGTH);
  return `${PREFIX}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const salt = Buffer.from(parts[1]!, 'base64');
  const expected = Buffer.from(parts[2]!, 'base64');
  const actual = scryptSync(plain, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
