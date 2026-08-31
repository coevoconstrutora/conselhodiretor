import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@conselho/db';
import { hashPassword, verifyPassword } from './password';
import { createSession, validateSession, deleteSession } from './session';
import {
  createPasswordResetToken,
  validatePasswordResetToken,
  consumePasswordResetToken,
} from './password-reset';


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
    const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
    const companyId = company.rows[0]!.id;
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['medico@conselho.test', 'Dr. Teste', hashPassword('pw'), companyId],
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

describe('Password reset tokens (DB-backed)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
    const companyId = company.rows[0]!.id;
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['reset@conselho.test', 'Usuário Teste', hashPassword('pw'), companyId],
    );
    userId = res.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('cria e valida um token de recuperação', async () => {
    const { token } = await createPasswordResetToken(exec, userId);
    const info = await validatePasswordResetToken(exec, token);
    expect(info?.userId).toBe(userId);
  });

  it('o token persistido é apenas o hash (não o token em claro)', async () => {
    const { token } = await createPasswordResetToken(exec, userId);
    const rows = await exec.query<{ token_hash: string }>('SELECT token_hash FROM password_reset_token');
    expect(rows.rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it('rejeita token inexistente', async () => {
    expect(await validatePasswordResetToken(exec, 'token-inexistente')).toBeNull();
  });

  it('invalida token expirado', async () => {
    const { token } = await createPasswordResetToken(exec, userId, -1000);
    expect(await validatePasswordResetToken(exec, token)).toBeNull();
  });

  it('consumePasswordResetToken impede reuso do mesmo link', async () => {
    const { token } = await createPasswordResetToken(exec, userId);
    await consumePasswordResetToken(exec, token);
    expect(await validatePasswordResetToken(exec, token)).toBeNull();
  });
});
