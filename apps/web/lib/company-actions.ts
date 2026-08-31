'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { setActiveCompany } from '@conselho/auth';
import { getAgentProfiles } from '@conselho/kb';
import { ALL_AGENT_IDS } from '@conselho/providers';
import type { CompanyRow } from '@conselho/db';
import { getCurrentUser, SESSION_COOKIE } from './auth';
import { getDb } from './db';
import { loadAndApplyProfileOverrides } from './kb-sources';

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

/** Super-admin escolhe qual empresa está visualizando agora (persiste na sessão). */
export async function switchCompanyAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.isSuperAdmin) throw new Error('Só super-admin troca de empresa.');
  const companyId = String(formData.get('companyId') ?? '');
  if (!companyId) throw new Error('Empresa inválida.');

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  const db = await getDb();
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
 * Cria uma empresa nova — clona a ESTRUTURA dos 9 conselheiros (nome/escopo)
 * da Coevo (empresa default) como ponto de partida; NUNCA copia conhecimento
 * (kb_source), perfil da empresa ou reuniões — a empresa nova começa "limpa"
 * nisso, só herdando os papéis.
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

  // Clona os 9 papéis a partir da Coevo (default) — nome/escopo ATUAIS dela
  // (incluindo customizações já feitas), NUNCA conhecimento (kb_source).
  const coevo = await db.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
  const templateCompanyId = coevo.rows[0]?.id;
  if (templateCompanyId) {
    await loadAndApplyProfileOverrides(db, templateCompanyId); // hidrata em memória com o que está no banco
    const templateProfiles = getAgentProfiles(templateCompanyId);
    for (const agentId of ALL_AGENT_IDS) {
      const p = templateProfiles[agentId];
      await db.query(
        `INSERT INTO agent_profile (company_id, agent_id, display_name, scope) VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, agent_id) DO NOTHING`,
        [companyId, agentId, p.displayName, p.scope],
      );
    }
  }

  revalidatePath('/admin/companies');
  return { ok: `Empresa "${name}" criada — use o seletor no topo para trocar para ela.` };
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
