'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  verifyPassword,
  hashPassword,
  createSession,
  deleteSession,
  createPasswordResetToken,
  validatePasswordResetToken,
  consumePasswordResetToken,
} from '@conselho/auth';
import { getDb } from './db';
import { SESSION_COOKIE } from './auth';
import { sendPasswordResetEmail } from './email';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { error: 'Informe email e senha.' };
  }

  const db = await getDb();
  const res = await db.query<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM app_user WHERE email = $1',
    [email],
  );
  const user = res.rows[0];
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    return { error: 'Credenciais inválidas.' };
  }

  const { token, expiresAt } = await createSession(db, user.id);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await deleteSession(db, token);
    jar.delete(SESSION_COOKIE);
  }
  redirect('/login');
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export interface ForgotPasswordState {
  error?: string;
  ok?: string;
}

/**
 * Sempre responde com a MESMA mensagem de sucesso, exista ou não o e-mail —
 * não vazar quais e-mails têm conta (enumeração de usuários).
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const CONFIRMATION = { ok: 'Se esse e-mail tiver uma conta, enviamos um link de recuperação.' };
  if (!email) return { error: 'Informe o e-mail.' };

  const db = await getDb();
  const res = await db.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [email]);
  const user = res.rows[0];
  if (!user) return CONFIRMATION;

  const { token } = await createPasswordResetToken(db, user.id);
  const origin = await siteOrigin();
  try {
    await sendPasswordResetEmail(email, `${origin}/reset-password?token=${token}`);
  } catch (err) {
    console.error('[auth] envio do e-mail de recuperação falhou:', err);
  }
  return CONFIRMATION;
}

export interface ResetPasswordState {
  error?: string;
  ok?: boolean;
}

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!token) return { error: 'Link inválido — peça um novo.' };
  if (password.length < 8) return { error: 'A senha precisa de pelo menos 8 caracteres.' };

  const db = await getDb();
  const info = await validatePasswordResetToken(db, token);
  if (!info) return { error: 'Link inválido ou expirado — peça um novo.' };

  await db.query('UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1', [
    info.userId,
    hashPassword(password),
  ]);
  await consumePasswordResetToken(db, token);
  return { ok: true };
}
