import { cookies } from 'next/headers';
import { validateSession } from '@conselho/auth';
import type { AppUserRole } from '@conselho/db';
import { getDb } from './db';

export const SESSION_COOKIE = 'conselho_session';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  /** Papel NESTA empresa (company_member) — a mesma pessoa pode ter papéis diferentes em cada empresa. */
  role: AppUserRole;
  /** Empresa ATIVA nesta sessão — home, ou a escolhida via seletor. */
  companyId: string;
  /** Empresa "casa" do usuário (login inicial) — independe do que está visualizando agora. */
  homeCompanyId: string;
  isSuperAdmin: boolean;
}

/** Papel da identidade NUMA empresa específica — null se não é membro dela. */
async function getMembershipRole(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  companyId: string,
): Promise<AppUserRole | null> {
  const res = await db.query<{ role: AppUserRole }>(
    'SELECT role FROM company_member WHERE user_id = $1 AND company_id = $2',
    [userId, companyId],
  );
  return res.rows[0]?.role ?? null;
}

/** Identidade do usuário autenticado, lida da sessão. Null se não autenticado. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await validateSession(db, token);
  if (!session) return null;

  const res = await db.query<{
    id: string;
    email: string;
    display_name: string;
    company_id: string;
    is_super_admin: boolean;
  }>('SELECT id, email, display_name, company_id, is_super_admin FROM app_user WHERE id = $1', [
    session.userId,
  ]);
  const user = res.rows[0];
  if (!user) return null;

  let companyId = session.activeCompanyId ?? user.company_id;
  let role = await getMembershipRole(db, user.id, companyId);

  // Membership órfã (empresa trocada sem vínculo válido, ou active_company_id
  // apontando pra empresa que a pessoa não/não-mais pertence): super-admin
  // sempre pode ver (papel 'admin' implícito); usuário comum volta pra home.
  if (role === null) {
    if (user.is_super_admin) {
      role = 'admin';
    } else {
      companyId = user.company_id;
      role = (await getMembershipRole(db, user.id, companyId)) ?? 'convidado';
    }
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role,
    companyId,
    homeCompanyId: user.company_id,
    isSuperAdmin: user.is_super_admin,
  };
}

/** Empresas que o PRÓPRIO usuário integra (company_member) — pro seletor de quem não é super-admin. */
export async function listMyCompanies(
  userId: string,
): Promise<Array<{ id: string; name: string }>> {
  const db = await getDb();
  const res = await db.query<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM company c
     JOIN company_member cm ON cm.company_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.created_at ASC`,
    [userId],
  );
  return res.rows;
}

/** Só admin gerencia usuários — guard reutilizado pela página e pelas actions. */
export function isAdmin(user: CurrentUser | null): boolean {
  return user?.role === 'admin';
}

/** Convidado é somente-leitura: sem criar/rodar reuniões, gerar relatórios ou editar conselheiros. */
export function canWrite(user: CurrentUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'gestor';
}
