import { createHash, randomBytes } from 'node:crypto';
import type { SqlExecutor } from '@conselho/db';

/**
 * Sessões com persistência no banco. O cookie carrega um token opaco aleatório;
 * o banco guarda apenas o SHA-256 do token (`token_hash`), de modo que um vazamento
 * do banco não expõe tokens utilizáveis. Expiração padrão: 7 dias.
 */
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface SessionInfo {
  userId: string;
  /** Empresa que um super-admin escolheu visualizar agora (null = a própria/home). */
  activeCompanyId: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: SqlExecutor,
  userId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.query('INSERT INTO session (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hashToken(token),
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function validateSession(db: SqlExecutor, token: string): Promise<SessionInfo | null> {
  const res = await db.query<{ user_id: string; expires_at: string | Date; active_company_id: string | null }>(
    'SELECT user_id, expires_at, active_company_id FROM session WHERE token_hash = $1',
    [hashToken(token)],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await deleteSession(db, token);
    return null;
  }
  return { userId: row.user_id, activeCompanyId: row.active_company_id };
}

/** Super-admin troca a empresa que está visualizando (persiste na própria sessão). */
export async function setActiveCompany(
  db: SqlExecutor,
  token: string,
  companyId: string | null,
): Promise<void> {
  await db.query('UPDATE session SET active_company_id = $2 WHERE token_hash = $1', [
    hashToken(token),
    companyId,
  ]);
}

export async function deleteSession(db: SqlExecutor, token: string): Promise<void> {
  await db.query('DELETE FROM session WHERE token_hash = $1', [hashToken(token)]);
}
