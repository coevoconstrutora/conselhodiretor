'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { setActiveCompany } from '@conselho/auth';
import { resetAgentProfiles } from '@conselho/kb';
import { COUNSELOR_AGENT_IDS } from '@conselho/providers';
import type { CompanyRow } from '@conselho/db';
import { getCurrentUser, SESSION_COOKIE } from './auth';
import { getDb } from './db';

/**
 * Multi-empresa (super-admin): listar/criar empresas e trocar qual está
 * "ativa" na sessão. Toda mutação aqui é super-admin-only — um usuário comum
 * nem sabe que outras empresas existem.
 */

export interface CompanySummary {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}

export async function listCompanies(): Promise<CompanySummary[]> {
  const db = await getDb();
  const res = await db.query<CompanyRow>('SELECT id, slug, name, created_at FROM company ORDER BY created_at ASC');
  return res.rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, createdAt: new Date(r.created_at) }));
}

/**
 * Troca a empresa "ativa" na sessão. Super-admin pode escolher QUALQUER
 * empresa; usuário comum só pode escolher uma das que ele É MEMBRO
 * (company_member) — nunca uma arbitrária.
 */
export async function switchCompanyAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const companyId = String(formData.get('companyId') ?? '');
  if (!companyId) throw new Error('Empresa inválida.');

  const db = await getDb();
  if (!user.isSuperAdmin) {
    const membership = await db.query<{ id: string }>(
      'SELECT id FROM company_member WHERE user_id = $1 AND company_id = $2',
      [user.id, companyId],
    );
    if (membership.rows.length === 0) throw new Error('Você não pertence a essa empresa.');
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  // volta pra "home" quando escolhe a própria empresa — active_company_id NULL
  await setActiveCompany(db, token, companyId === user.homeCompanyId ? null : companyId);
  revalidatePath('/');
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'empresa'
  );
}

export type CreateCompanyState = { error?: string; ok?: string } | null;

/**
 * Cria uma empresa nova — SEMPRE 100% isolada: nasce só com os 9 papéis
 * genéricos do produto (`DEFAULT_AGENT_PROFILES`, aplicado automaticamente
 * por `getAgentProfiles` quando não há linha em `agent_profile`), zero
 * conselheiro custom e zero conhecimento. NUNCA clona nome/escopo/perfil de
 * outra empresa — mesmo campos "estruturais" como escopo viraram, na prática,
 * lugar de contexto de NEGÓCIO (perfil profissional, critérios de decisão),
 * então clonar de uma empresa real vazaria informação dela pras demais.
 */
export async function createCompanyAction(
  _prev: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!user.isSuperAdmin) return { error: 'Só super-admin cria empresas.' };

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Informe o nome da empresa.' };

  const db = await getDb();
  const slugBase = slugify(name);
  let slug = slugBase;
  for (let i = 2; ; i++) {
    const exists = await db.query<{ id: string }>('SELECT id FROM company WHERE slug = $1', [slug]);
    if (exists.rows.length === 0) break;
    slug = `${slugBase}-${i}`;
  }

  const created = await db.query<{ id: string }>(
    'INSERT INTO company (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, name],
  );
  const companyId = created.rows[0]!.id;

  // "Comitê Geral" (todos os conselheiros) — toda empresa precisa de pelo
  // menos 1 tipo de reunião pra escolher ao criar reunião.
  await db.query(
    'INSERT INTO meeting_type (company_id, name, agent_ids, is_default) VALUES ($1, $2, $3, true)',
    [companyId, 'Comitê Geral', COUNSELOR_AGENT_IDS as string[]],
  );

  revalidatePath('/admin/companies');
  return { ok: `Empresa "${name}" criada — use o seletor no topo para trocar para ela.` };
}

export type ResetCounselorsState = { error?: string; ok?: string } | null;

/**
 * Reseta os conselheiros de UMA empresa pros 9 papéis genéricos do produto —
 * apaga toda personalização (nomes/escopos editados + conselheiros custom
 * daquela empresa). Remediação da era em que `createCompanyAction` clonava
 * o perfil da Coevo em toda empresa nova (corrigido); serve pra limpar
 * qualquer empresa que ainda carregue esse resíduo.
 */
export async function resetCompanyCounselorsAction(
  _prev: ResetCounselorsState,
  formData: FormData,
): Promise<ResetCounselorsState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!user.isSuperAdmin) return { error: 'Só super-admin reseta conselheiros.' };

  const companyId = String(formData.get('companyId') ?? '');
  if (!companyId) return { error: 'Empresa inválida.' };

  const db = await getDb();
  await db.query('DELETE FROM agent_profile WHERE company_id = $1', [companyId]);
  resetAgentProfiles(companyId); // limpa o cache em memória — vale na próxima leitura, sem restart

  revalidatePath('/admin/companies');
  revalidatePath('/');
  revalidatePath('/counselors');
  return { ok: 'Conselheiros resetados para o padrão do produto.' };
}

export type RenameCompanyState = { error?: string; ok?: string } | null;

/** Renomeia uma empresa qualquer (mesma fonte de verdade usada em /company). */
export async function renameCompanyAction(
  _prev: RenameCompanyState,
  formData: FormData,
): Promise<RenameCompanyState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!user.isSuperAdmin) return { error: 'Só super-admin renomeia empresas.' };

  const companyId = String(formData.get('companyId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!companyId) return { error: 'Empresa inválida.' };
  if (name.length < 2) return { error: 'Informe um nome válido.' };

  const db = await getDb();
  const res = await db.query<{ id: string }>(
    'UPDATE company SET name = $2 WHERE id = $1 RETURNING id',
    [companyId, name],
  );
  if (res.rows.length === 0) return { error: 'Empresa não encontrada.' };

  revalidatePath('/admin/companies');
  revalidatePath('/');
  revalidatePath('/company');
  return { ok: `Renomeada para "${name}".` };
}
