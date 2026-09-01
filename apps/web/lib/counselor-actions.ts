'use server';

import { revalidatePath } from 'next/cache';
import { type AgentId } from '@conselho/providers';
import { getAgentProfiles } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getCompanyKnowledgeStore } from './board-runtime';
import {
  addKbSource,
  deleteKbSource,
  fetchUrlText,
  saveAgentProfile,
  rebuildAgentKnowledge,
  loadAndApplyProfileOverrides,
  createCustomCounselor,
  deleteCustomCounselor,
} from './kb-sources';

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
    const scope = String(formData.get('scope') ?? '').trim();
    if (displayName.length < 3) return { error: 'O nome precisa de pelo menos 3 caracteres.' };
    if (scope.length < 20)
      return { error: 'O escopo precisa descrever a especialidade (mínimo 20 caracteres).' };
    await saveAgentProfile(db, user.companyId, agentId, displayName, scope);
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
    await addKbSource(db, user.companyId, agentId, { kind: 'text', title, content }, getEncryptionKey());
    await rebuild(user.companyId, agentId);
    revalidatePath(`/counselors/${agentId}`);
    return { ok: `Texto adicionado ao conhecimento — aplicado ao vivo.` };
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
    const { title, text } = await fetchUrlText(url);
    await addKbSource(db, user.companyId, agentId, { kind: 'url', title, ref: url, content: text }, getEncryptionKey());
    await rebuild(user.companyId, agentId);
    revalidatePath(`/counselors/${agentId}`);
    return { ok: `Link importado ("${title}") — conhecimento aplicado ao vivo.` };
  } catch (err) {
    console.error('[conselheiros] importar URL falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao importar a URL.' };
  }
}

const TEXT_FILE_RE = /\.(txt|md|markdown|csv)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB de texto puro

/** Adiciona conhecimento por ARQUIVO (.txt/.md/.csv — texto puro). */
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
      return { error: 'Selecione um arquivo .txt, .md ou .csv.' };
    if (!TEXT_FILE_RE.test(file.name))
      return {
        error:
          'Formato não suportado. Envie .txt, .md ou .csv — para PDF/Word, copie o texto e use "Colar texto".',
      };
    if (file.size > MAX_FILE_BYTES) return { error: 'Arquivo grande demais (máx. 2 MB de texto).' };
    const content = (await file.text()).trim();
    if (content.length < 20) return { error: 'O arquivo não tem texto útil.' };
    await addKbSource(
      db,
      user.companyId,
      agentId,
      { kind: 'file', title: file.name, ref: file.name, content },
      getEncryptionKey(),
    );
    await rebuild(user.companyId, agentId);
    revalidatePath(`/counselors/${agentId}`);
    return { ok: `Arquivo "${file.name}" adicionado — conhecimento aplicado ao vivo.` };
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
    const scope = String(formData.get('scope') ?? '').trim();
    const triggerKeywords = String(formData.get('triggerKeywords') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const db = await getDb();
    const agentId = await createCustomCounselor(db, user.companyId, displayName, scope, triggerKeywords);
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
