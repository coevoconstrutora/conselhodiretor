'use server';

import { revalidatePath } from 'next/cache';
import { type AgentId } from '@conselho/providers';
import { getAgentProfiles } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getCompanyKnowledgeStore } from './board-runtime';
import { extractUploadedFileText } from './text-extract';
import {
  addKbSource,
  deleteKbSource,
  fetchUrlText,
  saveAgentProfile,
  rebuildAgentKnowledge,
  loadAndApplyProfileOverrides,
  createCustomCounselor,
  deleteCustomCounselor,
  SCOPE_FIELD_MAX,
  PROFESSIONAL_PROFILE_MAX,
  DECISION_CRITERIA_MAX,
  type ProfileFieldsInput,
} from './kb-sources';

/** Lê os 4 campos do perfil profissional (ícone, formação, critérios, postura de risco) de um FormData. */
function parseProfileFields(formData: FormData): ProfileFieldsInput {
  return {
    iconKey: String(formData.get('iconKey') ?? '').trim() || null,
    iconColor: String(formData.get('iconColor') ?? '').trim() || null,
    professionalProfile: String(formData.get('professionalProfile') ?? '').trim() || null,
    decisionCriteria: String(formData.get('decisionCriteria') ?? '').trim() || null,
    riskPosture: String(formData.get('riskPosture') ?? '').trim() || null,
    riskPostureNotes: String(formData.get('riskPostureNotes') ?? '').trim() || null,
  };
}

/**
 * Actions do "NotebookLM por conselheiro". Padrão de erro: retornam
 * `{ error }` para o `useActionState` (fetch de URL e upload têm muitos modos
 * de falha que o usuário precisa LER) — mensagens pt-BR acionáveis.
 * Toda mudança reconstrói o namespace do agente AO VIVO (sem restart).
 * Multi-tenant: tudo escopado por `user.companyId` — nunca outra empresa.
 */

export type CounselorActionState = { error?: string; ok?: string } | null;

/** Valida contra o roster REAL da empresa (padrão + CUSTOM) — nunca uma lista fixa. */
async function parseAgentId(db: Awaited<ReturnType<typeof getDb>>, companyId: string, value: unknown): Promise<AgentId> {
  const id = String(value ?? '');
  await loadAndApplyProfileOverrides(db, companyId);
  if (!getAgentProfiles(companyId)[id]) throw new Error('Agente inválido.');
  return id as AgentId;
}

async function rebuild(companyId: string, agentId: AgentId): Promise<void> {
  const kb = await getCompanyKnowledgeStore(companyId);
  const db = await getDb();
  await rebuildAgentKnowledge(kb, db, companyId, agentId, getEncryptionKey());
}

/** Edita nome/escopo do conselheiro (vale imediatamente para novos prompts). */
export async function updateCounselorProfileAction(
  _prev: CounselorActionState,
  formData: FormData,
): Promise<CounselorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar conselheiros.' };
  try {
    const db = await getDb();
    const agentId = await parseAgentId(db, user.companyId, formData.get('agentId'));
    const displayName = String(formData.get('displayName') ?? '').trim();
    const scopeCan = String(formData.get('scopeCan') ?? '').trim();
    const scopeCannot = String(formData.get('scopeCannot') ?? '').trim();
    if (displayName.length < 3) return { error: 'O nome precisa de pelo menos 3 caracteres.' };
    if (scopeCan.length < 20)
      return { error: '"O que pode" precisa descrever a especialidade (mínimo 20 caracteres).' };
    if (scopeCan.length > SCOPE_FIELD_MAX || scopeCannot.length > SCOPE_FIELD_MAX)
      return { error: `Cada campo de escopo tem no máximo ${SCOPE_FIELD_MAX} caracteres.` };
    const profileFields = parseProfileFields(formData);
    if (
      (profileFields.professionalProfile?.length ?? 0) > PROFESSIONAL_PROFILE_MAX ||
      (profileFields.decisionCriteria?.length ?? 0) > DECISION_CRITERIA_MAX
    ) {
      return { error: 'Perfil profissional ou critérios de decisão passaram do limite de caracteres.' };
    }
    await saveAgentProfile(db, user.companyId, agentId, displayName, scopeCan, scopeCannot, profileFields);
    revalidatePath(`/counselors/${agentId}`);
    revalidatePath('/');
    return { ok: 'Perfil atualizado — já vale para as próximas contribuições.' };
  } catch (err) {
    console.error('[conselheiros] editar perfil falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao salvar o perfil.' };
  }
}

/** Adiciona conhecimento por texto colado. */
export async function addTextSourceAction(
  _prev: CounselorActionState,
  formData: FormData,
): Promise<CounselorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar conselheiros.' };
  try {
    const db = await getDb();
    const agentId = await parseAgentId(db, user.companyId, formData.get('agentId'));
    if (agentId === 'presidente')
      return { error: 'O Presidente não tem base própria — ele sintetiza os demais.' };
    const title = String(formData.get('title') ?? '').trim();
    const content = String(formData.get('content') ?? '').trim();
    if (!title) return { error: 'Dê um título à fonte (ex.: "Política de contingência 2026").' };
    if (content.length < 20) return { error: 'O texto é curto demais (mínimo 20 caracteres).' };
    const added = await addKbSource(db, user.companyId, agentId, { kind: 'text', title, content }, getEncryptionKey());
    await rebuild(user.companyId, agentId);
    revalidatePath(`/counselors/${agentId}`);
    return {
      ok: `Texto adicionado (${added.chars.toLocaleString('pt-BR')} caracteres) — aplicado ao vivo.\n"${added.preview}"`,
    };
  } catch (err) {
    console.error('[conselheiros] adicionar texto falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao adicionar o texto.' };
  }
}

/** Adiciona conhecimento por LINK — baixa a página e extrai o texto. */
export async function addUrlSourceAction(
  _prev: CounselorActionState,
  formData: FormData,
): Promise<CounselorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar conselheiros.' };
  try {
    const db = await getDb();
    const agentId = await parseAgentId(db, user.companyId, formData.get('agentId'));
    if (agentId === 'presidente')
      return { error: 'O Presidente não tem base própria — ele sintetiza os demais.' };
    const url = String(formData.get('url') ?? '').trim();
    if (!url) return { error: 'Informe a URL.' };
    const rescanDaysRaw = String(formData.get('rescanDays') ?? '').trim();
    const rescanDays = rescanDaysRaw ? Number(rescanDaysRaw) : null;
    const { title, text } = await fetchUrlText(url);
    const added = await addKbSource(
      db,
      user.companyId,
      agentId,
      { kind: 'url', title, ref: url, content: text, rescanDays },
      getEncryptionKey(),
    );
    await rebuild(user.companyId, agentId);
    revalidatePath(`/counselors/${agentId}`);
    const rescanNote = rescanDays ? ` Revisão automática a cada ${rescanDays} dia(s).` : '';
    return {
      ok: `Link importado ("${title}", ${added.chars.toLocaleString('pt-BR')} caracteres) — aplicado ao vivo.${rescanNote}\n"${added.preview}"`,
    };
  } catch (err) {
    console.error('[conselheiros] importar URL falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao importar a URL.' };
  }
}

/** Adiciona conhecimento por ARQUIVO (.txt/.md/.csv/.pdf/.docx). */
export async function addFileSourceAction(
  _prev: CounselorActionState,
  formData: FormData,
): Promise<CounselorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar conselheiros.' };
  try {
    const db = await getDb();
    const agentId = await parseAgentId(db, user.companyId, formData.get('agentId'));
    if (agentId === 'presidente')
      return { error: 'O Presidente não tem base própria — ele sintetiza os demais.' };
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0)
      return { error: 'Selecione um arquivo .txt, .md, .csv, .pdf ou .docx.' };
    const content = await extractUploadedFileText(file);
    const added = await addKbSource(
      db,
      user.companyId,
      agentId,
      { kind: 'file', title: file.name, ref: file.name, content },
      getEncryptionKey(),
    );
    await rebuild(user.companyId, agentId);
    revalidatePath(`/counselors/${agentId}`);
    return {
      ok: `Arquivo "${file.name}" adicionado (${added.chars.toLocaleString('pt-BR')} caracteres) — aplicado ao vivo.\n"${added.preview}"`,
    };
  } catch (err) {
    console.error('[conselheiros] upload falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada no upload.' };
  }
}

/** Remove uma fonte de conhecimento (e reconstrói o namespace). */
export async function deleteSourceAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem remover fontes.');
  const db = await getDb();
  const agentId = await parseAgentId(db, user.companyId, formData.get('agentId'));
  const sourceId = String(formData.get('sourceId') ?? '');
  if (!sourceId) throw new Error('Fonte inválida.');
  await deleteKbSource(db, user.companyId, sourceId, agentId);
  await rebuild(user.companyId, agentId);
  revalidatePath(`/counselors/${agentId}`);
}

/** Garante que só conselheiros com KB (todos exceto o Presidente) aceitam fontes. */
export async function isCounselorWithKb(agentId: AgentId): Promise<boolean> {
  return agentId !== 'presidente';
}

/**
 * Cria um conselheiro CUSTOM da empresa (gestão de membros do conselho —
 * "Configuração" → "Conselheiros"). Sem gatilho ele nunca reagiria a nada na
 * reunião, então as palavras-chave são obrigatórias aqui (não dá pra curar um
 * regex automático para um escopo desconhecido).
 */
export async function createCounselorAction(
  _prev: CounselorActionState,
  formData: FormData,
): Promise<CounselorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem criar conselheiros.' };
  try {
    const displayName = String(formData.get('displayName') ?? '').trim();
    const scopeCan = String(formData.get('scopeCan') ?? '').trim();
    const scopeCannot = String(formData.get('scopeCannot') ?? '').trim();
    if (scopeCan.length > SCOPE_FIELD_MAX || scopeCannot.length > SCOPE_FIELD_MAX)
      return { error: `Cada campo de escopo tem no máximo ${SCOPE_FIELD_MAX} caracteres.` };
    const triggerKeywords = String(formData.get('triggerKeywords') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const profileFields = parseProfileFields(formData);
    if (
      (profileFields.professionalProfile?.length ?? 0) > PROFESSIONAL_PROFILE_MAX ||
      (profileFields.decisionCriteria?.length ?? 0) > DECISION_CRITERIA_MAX
    ) {
      return { error: 'Perfil profissional ou critérios de decisão passaram do limite de caracteres.' };
    }
    const db = await getDb();
    const agentId = await createCustomCounselor(
      db,
      user.companyId,
      displayName,
      scopeCan,
      scopeCannot,
      triggerKeywords,
      profileFields,
    );
    revalidatePath('/counselors');
    revalidatePath('/');
    return { ok: `Conselheiro "${displayName}" criado — já pode alimentar a base dele em /counselors/${agentId}.` };
  } catch (err) {
    console.error('[conselheiros] criar conselheiro custom falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao criar o conselheiro.' };
  }
}

/** Remove um conselheiro CUSTOM (nunca um dos 9 padrão) e reconstrói o namespace dele (vazio). */
export async function deleteCounselorAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem remover conselheiros.');
  const agentId = String(formData.get('agentId') ?? '') as AgentId;
  if (!agentId) throw new Error('Conselheiro inválido.');
  const db = await getDb();
  await deleteCustomCounselor(db, user.companyId, agentId);
  revalidatePath('/counselors');
  revalidatePath('/');
}
