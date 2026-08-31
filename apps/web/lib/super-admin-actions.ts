'use server';

import { revalidatePath } from 'next/cache';
import { auditedClinicalWrite } from '@conselho/audit';
import { getCurrentUser } from './auth';
import { getDb } from './db';

/**
 * Governança de super-admin (Etapa 11 do roadmap) — promover/rebaixar pela
 * aplicação, não por SQL direto no banco de produção. Só um super-admin
 * existente pode mexer nisso; nunca se pode remover o ÚLTIMO super-admin
 * (travaria o acesso administrativo a todas as empresas).
 */

export interface SuperAdminCandidate {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  homeCompanyName: string;
}

export async function listSuperAdminCandidates(): Promise<SuperAdminCandidate[]> {
  const admin = await getCurrentUser();
  if (!admin || !admin.isSuperAdmin) return [];

  const db = await getDb();
  const res = await db.query<{
    id: string;
    email: string;
    display_name: string;
    is_super_admin: boolean;
    company_name: string;
  }>(
    `SELECT u.id, u.email, u.display_name, u.is_super_admin, c.name AS company_name
     FROM app_user u
     JOIN company c ON c.id = u.company_id
     ORDER BY u.is_super_admin DESC, u.display_name ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    isSuperAdmin: r.is_super_admin,
    homeCompanyName: r.company_name,
  }));
}

export type SuperAdminActionState = { error?: string; ok?: string } | null;

export async function promoteSuperAdminAction(
  _prev: SuperAdminActionState,
  formData: FormData,
): Promise<SuperAdminActionState> {
  const admin = await getCurrentUser();
  if (!admin) return { error: 'Sessão expirada — faça login novamente.' };
  if (!admin.isSuperAdmin) return { error: 'Só super-admin pode promover outro super-admin.' };

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { error: 'Usuário inválido.' };

  const db = await getDb();
  const target = await db.query<{ email: string; is_super_admin: boolean }>(
    'SELECT email, is_super_admin FROM app_user WHERE id = $1',
    [userId],
  );
  const row = target.rows[0];
  if (!row) return { error: 'Usuário não encontrado.' };
  if (row.is_super_admin) return { error: 'Esse usuário já é super-admin.' };

  await auditedClinicalWrite(
    db,
    { triggeredBy: `super-admin-promote-por-${admin.email}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('UPDATE app_user SET is_super_admin = true, updated_at = now() WHERE id = $1', [userId]);
      return null;
    },
  );

  revalidatePath('/admin/companies');
  return { ok: `${row.email} agora é super-admin.` };
}

export async function demoteSuperAdminAction(
  _prev: SuperAdminActionState,
  formData: FormData,
): Promise<SuperAdminActionState> {
  const admin = await getCurrentUser();
  if (!admin) return { error: 'Sessão expirada — faça login novamente.' };
  if (!admin.isSuperAdmin) return { error: 'Só super-admin pode remover outro super-admin.' };

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { error: 'Usuário inválido.' };

  const db = await getDb();
  const target = await db.query<{ email: string; is_super_admin: boolean }>(
    'SELECT email, is_super_admin FROM app_user WHERE id = $1',
    [userId],
  );
  const row = target.rows[0];
  if (!row) return { error: 'Usuário não encontrado.' };
  if (!row.is_super_admin) return { error: 'Esse usuário já não é super-admin.' };

  const remaining = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM app_user WHERE is_super_admin = true AND id != $1",
    [userId],
  );
  if (Number(remaining.rows[0]?.count ?? 0) === 0) {
    return { error: 'Precisa existir pelo menos um super-admin — promova outro antes de remover este.' };
  }

  await auditedClinicalWrite(
    db,
    { triggeredBy: `super-admin-demote-por-${admin.email}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('UPDATE app_user SET is_super_admin = false, updated_at = now() WHERE id = $1', [userId]);
      return null;
    },
  );

  revalidatePath('/admin/companies');
  return { ok: `${row.email} não é mais super-admin.` };
}
