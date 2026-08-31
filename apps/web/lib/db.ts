import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@conselho/db';
import { hashPassword } from '@conselho/auth';

/**
 * Acesso ao banco no servidor.
 * - Dev/local (sem DATABASE_URL): PGlite file-backed em `.pgdata` — Postgres real
 *   in-process, sem Docker. Permite logar e navegar o shell localmente.
 * - Produção (DATABASE_URL setado): driver `pg` com TLS obrigatório.
 * Aplica migrations no boot. O seed do usuário demo roda SÓ em dev local
 * (sem DATABASE_URL) — em produção o dono cria o próprio usuário via
 * `pnpm create-user` (nenhuma credencial conhecida publicamente pode nascer
 * num banco de produto vendido). Override explícito: ALLOW_DEMO_LOGIN=true.
 */

// Singleton resiliente ao HMR do Next (evita múltiplas instâncias em dev).
const globalForDb = globalThis as unknown as { __conselhoDb?: Promise<SqlExecutor> };

const DEMO_EMAIL = 'demo@conselho.test';
const DEMO_PASSWORD = 'conselho123';

async function seedDemoUser(db: SqlExecutor): Promise<void> {
  const res = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM app_user');
  if (Number(res.rows[0]?.count ?? 0) > 0) return;
  await db.query(
    "INSERT INTO app_user (email, display_name, password_hash, role) VALUES ($1, $2, $3, 'admin')",
    [DEMO_EMAIL, 'Empresário Demo', hashPassword(DEMO_PASSWORD)],
  );
}

async function init(): Promise<SqlExecutor> {
  const databaseUrl = process.env.DATABASE_URL;
  let exec: SqlExecutor;
  if (databaseUrl) {
    const { createPool, pgExecutor } = await import('@conselho/db');
    exec = pgExecutor(createPool());
  } else {
    exec = pgliteExecutor(new PGlite('./.pgdata'));
  }
  await runMigrations(exec);
  // Demo com credencial pública SÓ em dev local — nunca num Postgres real.
  if (!databaseUrl || process.env.ALLOW_DEMO_LOGIN === 'true') {
    await seedDemoUser(exec);
  }
  return exec;
}

export function getDb(): Promise<SqlExecutor> {
  if (!globalForDb.__conselhoDb) {
    globalForDb.__conselhoDb = init();
  }
  return globalForDb.__conselhoDb;
}

export const DEMO_CREDENTIALS = { email: DEMO_EMAIL, password: DEMO_PASSWORD };
