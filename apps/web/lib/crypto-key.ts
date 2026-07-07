import { loadEncryptionKey } from '@conselho/crypto';

/**
 * Chave de criptografia em repouso (NFR9) para o servidor web.
 * - Produção: exige `DATA_ENCRYPTION_KEY` (base64 de 32 bytes) — falha cedo se ausente.
 * - Dev/local (sem a env): usa uma chave fixa de desenvolvimento, apenas para permitir
 *   exercitar o fluxo localmente. NUNCA usar em produção (dados não seriam protegidos).
 */
const DEV_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');

export function getEncryptionKey(): Buffer {
  if (process.env.DATA_ENCRYPTION_KEY) {
    return loadEncryptionKey(process.env);
  }
  if (process.env.NODE_ENV === 'production') {
    // Em produção a chave é obrigatória — propaga o erro claro de loadEncryptionKey.
    return loadEncryptionKey(process.env);
  }
  return Buffer.from(DEV_KEY_BASE64, 'base64');
}
