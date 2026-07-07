import { cookies } from 'next/headers';
import { validateSession } from '@conselho/auth';
import { getDb } from './db';

export const SESSION_COOKIE = 'conselho_session';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
}

/** Identidade do usuário autenticado, lida da sessão. Null se não autenticado. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await validateSession(db, token);
  if (!session) return null;

  const res = await db.query<{ id: string; email: string; display_name: string }>(
    'SELECT id, email, display_name FROM app_user WHERE id = $1',
    [session.userId],
  );
  const user = res.rows[0];
  return user ? { id: user.id, email: user.email, displayName: user.display_name } : null;
}
