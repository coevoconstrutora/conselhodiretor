import type { SqlExecutor } from '@conselho/db';
import { hashPassword, verifyPassword } from './password';
import { deleteOtherSessions } from './session';

export const MIN_PASSWORD_LENGTH = 8;

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'user_not_found' | 'no_password_set' | 'wrong_current' | 'too_short' | 'same_as_current' };

/**
 * Troca de senha pelo PRÓPRIO usuário logado: exige a senha atual (quem
 * roubou só o cookie de sessão não consegue trancar o dono pra fora) e, ao
 * trocar, encerra todas as OUTRAS sessões — a sessão em uso (`keepSessionToken`)
 * continua. Tokens de recuperação pendentes também são invalidados.
 */
export async function changeUserPassword(
  db: SqlExecutor,
  params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    keepSessionToken: string | null;
  },
): Promise<ChangePasswordResult> {
  const { userId, currentPassword, newPassword, keepSessionToken } = params;
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too_short' };

  const res = await db.query<{ password_hash: string | null }>(
    'SELECT password_hash FROM app_user WHERE id = $1',
    [userId],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, reason: 'user_not_found' };
  if (!row.password_hash) return { ok: false, reason: 'no_password_set' };
  if (!verifyPassword(currentPassword, row.password_hash)) return { ok: false, reason: 'wrong_current' };
  if (currentPassword === newPassword) return { ok: false, reason: 'same_as_current' };

  await db.query('UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1', [
    userId,
    hashPassword(newPassword),
  ]);
  await deleteOtherSessions(db, userId, keepSessionToken);
  await db.query(
    'UPDATE password_reset_token SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  return { ok: true };
}
