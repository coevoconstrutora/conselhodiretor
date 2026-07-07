'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPassword, createSession, deleteSession } from '@conselho/auth';
import { getDb } from './db';
import { SESSION_COOKIE } from './auth';

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
