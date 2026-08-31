'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { hashPassword } from '@conselho/auth';
import type { AppUserRole } from '@conselho/db';
import { getCurrentUser, isAdmin } from './auth';
import { getDb } from './db';
import { sendCredentialsEmail } from './email';
import { siteOrigin } from './site-origin';

/**
 * Gestão de usuários — só admin, e sempre escopada à EMPRESA ATIVA do admin.
 * Multi-empresa por identidade: um e-mail (app_user) pode ser MEMBRO
 * (company_member) de várias empresas, com papel independente em cada uma —
 * "criar usuário" com um e-mail já existente vira "adicionar membership",
 * nunca uma segunda conta duplicada.
 */

function generatePassword(): string {
  return randomBytes(9).toString('base64url'); // 12 chars, sem ambiguidade de URL
}

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
    `SELECT u.id, u.email, u.display_name, cm.role, cm.created_at
     FROM company_member cm
     JOIN app_user u ON u.id = cm.user_id
     WHERE cm.company_id = $1
     ORDER BY cm.created_at ASC`,
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

/**
 * Adiciona um usuário à empresa ATIVA do admin. Se o e-mail já existe como
 * identidade (app_user) — mesmo que só em OUTRA empresa — não cria conta
 * nova: só cria o vínculo (company_member) com o papel escolhido aqui,
 * mantendo a senha que a pessoa já tem. Se o e-mail é novo, cria a
 * identidade com senha aleatória (exibida/enviada só esta vez).
 */
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
  if (!ROLES.has(role)) return { error: 'Papel inválido.' };

  const db = await getDb();
  const existing = await db.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [email]);
  const sendEmail = formData.get('sendEmail') === 'on';

  if (existing.rows.length > 0) {
    const userId = existing.rows[0]!.id;
    const already = await db.query<{ id: string }>(
      'SELECT id FROM company_member WHERE user_id = $1 AND company_id = $2',
      [userId, admin.companyId],
    );
    if (already.rows.length > 0) return { error: 'Esse e-mail já tem acesso a esta empresa.' };

    await db.query('INSERT INTO company_member (user_id, company_id, role) VALUES ($1, $2, $3)', [
      userId,
      admin.companyId,
      role,
    ]);
    revalidatePath('/users');
    return { ok: `${email} já tinha conta no Conselho — acesso a esta empresa adicionado (senha atual mantida).` };
  }

  if (displayName.length < 2) return { error: 'Informe o nome.' };

  const generatedPassword = generatePassword();
  const created = await db.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash, role, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [email, displayName, hashPassword(generatedPassword), role, admin.companyId],
  );
  await db.query('INSERT INTO company_member (user_id, company_id, role) VALUES ($1, $2, $3)', [
    created.rows[0]!.id,
    admin.companyId,
    role,
  ]);

  let emailSent = false;
  if (sendEmail) {
    try {
      await sendCredentialsEmail(email, {
        accessUrl: `${await siteOrigin()}/login`,
        email,
        password: generatedPassword,
      });
      emailSent = true;
    } catch (err) {
      console.error('[usuarios] envio de credenciais falhou:', err);
    }
  }

  revalidatePath('/users');
  return {
    ok: `Usuário ${email} criado.${emailSent ? ' Credenciais enviadas por e-mail.' : ''}`,
    generatedPassword,
  };
}

export type UserActionState = { error?: string; ok?: string } | null;

/** Muda o papel de um usuário NESTA EMPRESA (company_member) — admin não pode se rebaixar. */
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
      "SELECT count(*)::int AS count FROM company_member WHERE role = 'admin' AND company_id = $2 AND user_id != $1",
      [userId, admin.companyId],
    );
    if (Number(admins.rows[0]?.count ?? 0) === 0) {
      return { error: 'Precisa existir pelo menos um administrador.' };
    }
  }

  const res = await db.query<{ id: string }>(
    'UPDATE company_member SET role = $3 WHERE user_id = $1 AND company_id = $2 RETURNING id',
    [userId, admin.companyId, role],
  );
  if (res.rows.length === 0) return { error: 'Usuário não encontrado nesta empresa.' };
  revalidatePath('/users');
  return { ok: 'Papel atualizado.' };
}

/**
 * Remove o ACESSO de um usuário A ESTA EMPRESA (company_member) — nunca a
 * si mesmo, nunca o último admin. A identidade (app_user) NÃO é apagada:
 * a pessoa pode ter acesso a outras empresas.
 */
export async function deleteUserAction(formData: FormData): Promise<void> {
  const admin = await getCurrentUser();
  if (!admin) throw new Error('Não autenticado.');
  if (!isAdmin(admin)) throw new Error('Só administradores podem remover usuários.');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) throw new Error('userId ausente.');
  if (userId === admin.id) throw new Error('Você não pode remover a si mesmo.');

  const db = await getDb();
  const target = await db.query<{ role: AppUserRole }>(
    'SELECT role FROM company_member WHERE user_id = $1 AND company_id = $2',
    [userId, admin.companyId],
  );
  if (target.rows.length === 0) throw new Error('Usuário não encontrado nesta empresa.');
  if (target.rows[0]?.role === 'admin') {
    const admins = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM company_member WHERE role = 'admin' AND company_id = $2 AND user_id != $1",
      [userId, admin.companyId],
    );
    if (Number(admins.rows[0]?.count ?? 0) === 0) {
      throw new Error('Precisa existir pelo menos um administrador — remova outro admin antes.');
    }
  }

  await db.query('DELETE FROM company_member WHERE user_id = $1 AND company_id = $2', [
    userId,
    admin.companyId,
  ]);
  revalidatePath('/users');
}

/**
 * Gera uma senha NOVA para a IDENTIDADE (app_user) e envia por e-mail — a
 * senha é da PESSOA, não da empresa: se ela tem acesso a mais de uma
 * empresa, a senha nova vale para todas. Não existe "reenviar a mesma
 * senha" — ela nunca fica em claro no banco, então reenviar é sempre resetar.
 */
export async function sendCredentialsAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await getCurrentUser();
  if (!admin) return { error: 'Sessão expirada — faça login novamente.' };
  if (!isAdmin(admin)) return { error: 'Só administradores podem enviar credenciais.' };

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { error: 'Usuário inválido.' };

  const db = await getDb();
  const membership = await db.query<{ id: string }>(
    'SELECT id FROM company_member WHERE user_id = $1 AND company_id = $2',
    [userId, admin.companyId],
  );
  if (membership.rows.length === 0) return { error: 'Usuário não encontrado nesta empresa.' };

  const target = await db.query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [userId]);
  const email = target.rows[0]?.email;
  if (!email) return { error: 'Usuário não encontrado.' };

  const newPassword = generatePassword();
  await db.query('UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1', [
    userId,
    hashPassword(newPassword),
  ]);

  try {
    await sendCredentialsEmail(email, {
      accessUrl: `${await siteOrigin()}/login`,
      email,
      password: newPassword,
    });
  } catch (err) {
    console.error('[usuarios] envio de credenciais falhou:', err);
    return { error: 'Senha redefinida, mas o e-mail falhou ao enviar — tente de novo.' };
  }

  return { ok: `Credenciais enviadas para ${email}.` };
}
