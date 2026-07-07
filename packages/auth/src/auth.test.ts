import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@conselho/db';
import { hashPassword, verifyPassword } from './password';
import { createSession, validateSession, deleteSession } from './session';


describe('Password hashing (scrypt)', () => {
  it('verifica a senha correta e rejeita a errada', () => {
    const stored = hashPassword('s3nha-do-medico');
    expect(verifyPassword('s3nha-do-medico', stored)).toBe(true);
    expect(verifyPassword('senha-errada', stored)).toBe(false);
  });

  it('não armazena a senha em claro e gera hashes distintos (salt)', () => {
    const a = hashPassword('mesma-senha');
    const b = hashPassword('mesma-senha');
    expect(a).not.toContain('mesma-senha');
    expect(a).not.toBe(b);
    expect(verifyPassword('mesma-senha', a)).toBe(true);
  });

  it('rejeita formato inválido sem lançar', () => {
    expect(verifyPassword('x', 'formato-invalido')).toBe(false);
  });
});

describe('Sessions (DB-backed)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['medico@conselho.test', 'Dr. Teste', hashPassword('pw')],
    );
    userId = res.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('cria e valida uma sessão', async () => {
    const { token } = await createSession(exec, userId);
    const info = await validateSession(exec, token);
    expect(info?.userId).toBe(userId);
  });

  it('o token persistido é apenas o hash (não o token em claro)', async () => {
    const { token } = await createSession(exec, userId);
    const rows = await exec.query<{ token_hash: string }>('SELECT token_hash FROM session');
    expect(rows.rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it('rejeita token inválido', async () => {
    expect(await validateSession(exec, 'token-inexistente')).toBeNull();
  });

  it('invalida sessão expirada', async () => {
    const { token } = await createSession(exec, userId, -1000);
    expect(await validateSession(exec, token)).toBeNull();
  });

  it('deleteSession encerra o acesso (logout)', async () => {
    const { token } = await createSession(exec, userId);
    await deleteSession(exec, token);
    expect(await validateSession(exec, token)).toBeNull();
  });
});
