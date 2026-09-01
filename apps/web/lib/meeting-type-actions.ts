'use server';

import { revalidatePath } from 'next/cache';
import { PRESIDENT_AGENT_ID, type AgentId } from '@conselho/providers';
import { getAgentProfiles } from '@conselho/kb';
import type { MeetingTypeRow } from '@conselho/db';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { loadAndApplyProfileOverrides } from './kb-sources';

/**
 * Tipos de reunião ("Comitê Geral", "Comitê de Engenharia", ...) — escopam
 * quais conselheiros participam de uma reunião. O Presidente NUNCA entra na
 * lista: ele só sintetiza no final, não reage a gatilho, então não é um
 * "participante" no sentido desta feature.
 */

export interface MeetingTypeSummary {
  id: string;
  name: string;
  agentIds: AgentId[];
  isDefault: boolean;
}

function toSummary(row: MeetingTypeRow): MeetingTypeSummary {
  return {
    id: row.id,
    name: row.name,
    agentIds: row.agent_ids as AgentId[],
    isDefault: row.is_default,
  };
}

export async function listMeetingTypes(companyId: string): Promise<MeetingTypeSummary[]> {
  const db = await getDb();
  const res = await db.query<MeetingTypeRow>(
    'SELECT * FROM meeting_type WHERE company_id = $1 ORDER BY is_default DESC, name ASC',
    [companyId],
  );
  return res.rows.map(toSummary);
}

/** Valida contra o roster REAL da empresa (padrão + custom) — nunca uma lista fixa no código. */
async function parseAgentIds(db: Awaited<ReturnType<typeof getDb>>, companyId: string, formData: FormData): Promise<AgentId[]> {
  await loadAndApplyProfileOverrides(db, companyId);
  const roster = new Set(Object.keys(getAgentProfiles(companyId)));
  const selected = formData.getAll('agentIds').map(String);
  return selected.filter((id): id is AgentId => id !== PRESIDENT_AGENT_ID && roster.has(id));
}

export type MeetingTypeActionState = { error?: string; ok?: string } | null;

export async function createMeetingTypeAction(
  _prev: MeetingTypeActionState,
  formData: FormData,
): Promise<MeetingTypeActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem criar tipos de reunião.' };

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Informe um nome para o tipo de reunião.' };

  const db = await getDb();
  const agentIds = await parseAgentIds(db, user.companyId, formData);
  if (agentIds.length === 0) return { error: 'Escolha pelo menos um conselheiro.' };

  const exists = await db.query<{ id: string }>(
    'SELECT id FROM meeting_type WHERE company_id = $1 AND name = $2',
    [user.companyId, name],
  );
  if (exists.rows.length > 0) return { error: `Já existe um tipo de reunião chamado "${name}".` };

  await db.query(
    'INSERT INTO meeting_type (company_id, name, agent_ids) VALUES ($1, $2, $3)',
    [user.companyId, name, agentIds],
  );
  revalidatePath('/meeting-types');
  return { ok: `Tipo "${name}" criado.` };
}

export async function updateMeetingTypeAction(
  _prev: MeetingTypeActionState,
  formData: FormData,
): Promise<MeetingTypeActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar tipos de reunião.' };

  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!id) return { error: 'Tipo inválido.' };
  if (name.length < 2) return { error: 'Informe um nome para o tipo de reunião.' };

  const db = await getDb();
  const agentIds = await parseAgentIds(db, user.companyId, formData);
  if (agentIds.length === 0) return { error: 'Escolha pelo menos um conselheiro.' };

  const res = await db.query<{ id: string }>(
    `UPDATE meeting_type SET name = $3, agent_ids = $4, updated_at = now()
     WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, user.companyId, name, agentIds],
  );
  if (res.rows.length === 0) return { error: 'Tipo de reunião não encontrado.' };
  revalidatePath('/meeting-types');
  return { ok: `Tipo "${name}" atualizado.` };
}

export async function deleteMeetingTypeAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem remover tipos de reunião.');

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Tipo inválido.');

  const db = await getDb();
  const target = await db.query<{ is_default: boolean }>(
    'SELECT is_default FROM meeting_type WHERE id = $1 AND company_id = $2',
    [id, user.companyId],
  );
  if (target.rows.length === 0) throw new Error('Tipo de reunião não encontrado.');
  if (target.rows[0]?.is_default) {
    throw new Error('O tipo padrão ("Comitê Geral") não pode ser removido.');
  }

  // reuniões que já usavam este tipo voltam a não ter tipo (NULL) — não bloqueia a exclusão
  await db.query('UPDATE meeting SET meeting_type_id = NULL WHERE meeting_type_id = $1', [id]);
  await db.query('DELETE FROM meeting_type WHERE id = $1 AND company_id = $2', [id, user.companyId]);
  revalidatePath('/meeting-types');
}
