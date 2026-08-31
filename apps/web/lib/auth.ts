import { cookies } from 'next/headers';
import { validateSession } from '@conselho/auth';
import type { AppUserRole } from '@conselho/db';
import { getDb } from './db';

export const SESSION_COOKIE = 'conselho_session';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: AppUserRole;
}

/** Identidade do usuário autenticado, lida da sessão. Null se não autenticado. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await validateSession(db, token);
  if (!session) return null;

  const res = await db.query<{ id: string; email: string; display_name: string; role: AppUserRole }>(
    'SELECT id, email, display_name, role FROM app_user WHERE id = $1',
    [session.userId],
  );
  const user = res.rows[0];
  return user
    ? { id: user.id, email: user.email, displayName: user.display_name, role: user.role }
    : null;
}

/** Só admin gerencia usuários — guard reutilizado pela página e pelas actions. */
export function isAdmin(user: CurrentUser | null): boolean {
  return user?.role === 'admin';
}

/** Convidado é somente-leitura: sem criar/rodar reuniões, gerar relatórios ou editar conselheiros. */
export function canWrite(user: CurrentUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'gestor';
}
