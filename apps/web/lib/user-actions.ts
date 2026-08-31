'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { hashPassword } from '@conselho/auth';
import type { AppUserRole } from '@conselho/db';
import { getCurrentUser, isAdmin } from './auth';
import { getDb } from './db';

/**
 * Gestão de usuários — só admin, e sempre escopada à EMPRESA ATIVA do admin
 * (multi-tenant: usuários de uma empresa nunca aparecem/mexem em outra).
 * Papéis: admin (gestão de usuários + acesso total), gestor (uso diário, sem
 * gestão de usuários), convidado (leitura).
 */

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: AppUserRole;
  createdAt: Date;
}

export async function listUsers(): Promise<UserSummary[]> {
  const admin = await getCurrentUser();
  if (!admin) return [];
  const db = await getDb();
  const res = await db.query<{
    id: string;
    email: string;
    display_name: string;
    role: AppUserRole;
    created_at: Date;
  }>(
    'SELECT id, email, display_name, role, created_at FROM app_user WHERE company_id = $1 ORDER BY created_at ASC',
    [admin.companyId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    createdAt: new Date(r.created_at),
  }));
}

const ROLES = new Set<AppUserRole>(['admin', 'gestor', 'convidado']);

export type CreateUserState = { error?: string; ok?: string; generatedPassword?: string } | null;

/** Cria um usuário (na empresa ATIVA do admin) com senha aleatória — exibida só esta vez. */
export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const admin = await getCurrentUser();
  if (!admin) return { error: 'Sessão expirada — faça login novamente.' };
  if (!isAdmin(admin)) return { error: 'Só administradores podem cadastrar usuários.' };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const role = String(formData.get('role') ?? 'gestor') as AppUserRole;

  if (!email || !email.includes('@')) return { error: 'Informe um e-mail válido.' };
  if (displayName.length < 2) return { error: 'Informe o nome.' };
  if (!ROLES.has(role)) return { error: 'Papel inválido.' };

  const db = await getDb();
  const existing = await db.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [email]);
  if (existing.rows.length > 0) return { error: 'Já existe um usuário com esse e-mail.' };

  const generatedPassword = randomBytes(9).toString('base64url'); // 12 chars, sem ambiguidade de URL
  await db.query(
    'INSERT INTO app_user (email, display_name, password_hash, role, company_id) VALUES ($1, $2, $3, $4, $5)',
    [email, displayName, hashPassword(generatedPassword), role, admin.companyId],
  );

  revalidatePath('/users');
  return { ok: `Usuário ${email} criado.`, generatedPassword };
}

export type UserActionState = { error?: string; ok?: string } | null;

/** Muda o papel de um usuário DA MESMA EMPRESA — admin não pode se rebaixar. */
export async function updateUserRoleAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await getCurrentUser();
  if (!admin) return { error: 'Sessão expirada — faça login novamente.' };
  if (!isAdmin(admin)) return { error: 'Só administradores podem alterar papéis.' };

  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '') as AppUserRole;
  if (!userId || !ROLES.has(role)) return { error: 'Dados inválidos.' };
  if (userId === admin.id && role !== 'admin') {
    return { error: 'Você não pode remover seu próprio acesso de administrador.' };
  }

  const db = await getDb();
  if (role !== 'admin') {
    const admins = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM app_user WHERE role = 'admin' AND company_id = $2 AND id != $1",
      [userId, admin.companyId],
    );
    if (Number(admins.rows[0]?.count ?? 0) === 0) {
      return { error: 'Precisa existir pelo menos um administrador.' };
    }
  }

  await db.query('UPDATE app_user SET role = $2, updated_at = now() WHERE id = $1 AND company_id = $3', [
    userId,
    role,
    admin.companyId,
  ]);
  revalidatePath('/users');
  return { ok: 'Papel atualizado.' };
}

/** Remove um usuário DA MESMA EMPRESA — nunca a si mesmo, nunca o último admin. */
export async function deleteUserAction(formData: FormData): Promise<void> {
  const admin = await getCurrentUser();
  if (!admin) throw new Error('Não autenticado.');
  if (!isAdmin(admin)) throw new Error('Só administradores podem remover usuários.');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) throw new Error('userId ausente.');
  if (userId === admin.id) throw new Error('Você não pode remover a si mesmo.');

  const db = await getDb();
  const target = await db.query<{ role: AppUserRole }>(
    'SELECT role FROM app_user WHERE id = $1 AND company_id = $2',
    [userId, admin.companyId],
  );
  if (target.rows.length === 0) throw new Error('Usuário não encontrado.');
  if (target.rows[0]?.role === 'admin') {
    const admins = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM app_user WHERE role = 'admin' AND company_id = $2 AND id != $1",
      [userId, admin.companyId],
    );
    if (Number(admins.rows[0]?.count ?? 0) === 0) {
      throw new Error('Precisa existir pelo menos um administrador — remova outro admin antes.');
    }
  }

  await db.query('DELETE FROM app_user WHERE id = $1 AND company_id = $2', [userId, admin.companyId]);
  revalidatePath('/users');
}
