import { createHash, randomBytes } from 'node:crypto';
import type { SqlExecutor } from '@conselho/db';

/**
 * Token de recuperação de senha — mesmo padrão de `session`: o token opaco
 * vai só no link do e-mail; o banco guarda apenas o SHA-256 (`token_hash`).
 * TTL curto (1h): é um link de uso único, não uma sessão.
 */
const DEFAULT_TTL_MS = 1000 * 60 * 60;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPasswordResetToken(
  db: SqlExecutor,
  userId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.query(
    'INSERT INTO password_reset_token (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

/** Valida o token (existe, não expirou, não foi usado) sem consumi-lo. */
export async function validatePasswordResetToken(
  db: SqlExecutor,
  token: string,
): Promise<{ userId: string } | null> {
  const res = await db.query<{ user_id: string; expires_at: string | Date; used_at: string | Date | null }>(
    'SELECT user_id, expires_at, used_at FROM password_reset_token WHERE token_hash = $1',
    [hashToken(token)],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { userId: row.user_id };
}

/** Marca o token como usado — impede reuso do mesmo link. */
export async function consumePasswordResetToken(db: SqlExecutor, token: string): Promise<void> {
  await db.query('UPDATE password_reset_token SET used_at = now() WHERE token_hash = $1', [
    hashToken(token),
  ]);
}
