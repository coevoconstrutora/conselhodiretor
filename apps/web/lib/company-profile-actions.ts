'use server';

import { revalidatePath } from 'next/cache';
import type { CompanyProfile } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { saveCompanyProfile, addCompanySource, deleteCompanySource } from './company-profile';
import { fetchUrlText } from './kb-sources';
import { extractUploadedFileText } from './text-extract';
import { lookupCnpj, CnpjLookupError, type CnpjData } from './cnpj-lookup';

export type CompanyProfileActionState = { error?: string; ok?: string } | null;

/** Salva o perfil da empresa — vale imediatamente para os 9 conselheiros (sem restart). */
export async function saveCompanyProfileAction(
  _prev: CompanyProfileActionState,
  formData: FormData,
): Promise<CompanyProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar o perfil da empresa.' };

  const region = [
    ...new Set(
      formData
        .getAll('region')
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  ];

  const profile: CompanyProfile = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    cnpj: String(formData.get('cnpj') ?? '').trim() || undefined,
    size: String(formData.get('size') ?? '').trim() || undefined,
    segment: String(formData.get('segment') ?? '').trim() || undefined,
    region: region.length > 0 ? region : undefined,
    notes: String(formData.get('notes') ?? '').trim() || undefined,
  };

  const db = await getDb();
  await saveCompanyProfile(db, user.companyId, getEncryptionKey(), profile);
  revalidatePath('/company');
  revalidatePath('/');
  return { ok: 'Perfil da empresa salvo — já vale para todos os conselheiros.' };
}

/** Adiciona conhecimento por texto colado. */
export async function addCompanyTextSourceAction(
  _prev: CompanyProfileActionState,
  formData: FormData,
): Promise<CompanyProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar o perfil da empresa.' };
  try {
    const title = String(formData.get('title') ?? '').trim();
    const content = String(formData.get('content') ?? '').trim();
    if (!title) return { error: 'Dê um título ao documento (ex.: "Plano de negócios 2026").' };
    if (content.length < 20) return { error: 'O texto é curto demais (mínimo 20 caracteres).' };
    const db = await getDb();
    await addCompanySource(db, user.companyId, getEncryptionKey(), { kind: 'text', title, content });
    revalidatePath('/company');
    return { ok: 'Texto adicionado — já vale para todos os conselheiros.' };
  } catch (err) {
    console.error('[empresa] adicionar texto falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao adicionar o texto.' };
  }
}

/** Adiciona conhecimento por LINK — baixa a página e extrai o texto. */
export async function addCompanyUrlSourceAction(
  _prev: CompanyProfileActionState,
  formData: FormData,
): Promise<CompanyProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar o perfil da empresa.' };
  try {
    const url = String(formData.get('url') ?? '').trim();
    if (!url) return { error: 'Informe a URL.' };
    const { title, text } = await fetchUrlText(url);
    const db = await getDb();
    await addCompanySource(db, user.companyId, getEncryptionKey(), { kind: 'url', title, ref: url, content: text });
    revalidatePath('/company');
    return { ok: `Link importado ("${title}") — já vale para todos os conselheiros.` };
  } catch (err) {
    console.error('[empresa] importar URL falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao importar a URL.' };
  }
}

/** Adiciona conhecimento por ARQUIVO (.txt/.md/.csv/.pdf/.docx). */
export async function addCompanyFileSourceAction(
  _prev: CompanyProfileActionState,
  formData: FormData,
): Promise<CompanyProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar o perfil da empresa.' };
  try {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0)
      return { error: 'Selecione um arquivo .txt, .md, .csv, .pdf ou .docx.' };
    const content = await extractUploadedFileText(file);
    const db = await getDb();
    await addCompanySource(db, user.companyId, getEncryptionKey(), {
      kind: 'file',
      title: file.name,
      ref: file.name,
      content,
    });
    revalidatePath('/company');
    return { ok: `Arquivo "${file.name}" adicionado — já vale para todos os conselheiros.` };
  } catch (err) {
    console.error('[empresa] upload falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada no upload.' };
  }
}

export type LookupCnpjResult = { ok: true; data: CnpjData } | { ok: false; error: string };

/**
 * Consulta o CNPJ na Receita (via BrasilAPI) — só devolve os dados para o
 * cliente pré-preencher o formulário; NADA é salvo até o usuário revisar e
 * clicar em "Salvar perfil da empresa".
 */
export async function lookupCnpjAction(cnpj: string): Promise<LookupCnpjResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { ok: false, error: 'Convidados não podem consultar CNPJ.' };
  try {
    const data = await lookupCnpj(cnpj);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof CnpjLookupError ? err.message : 'Falha inesperada ao consultar o CNPJ.' };
  }
}

/** Remove um documento do perfil da empresa. */
export async function deleteCompanySourceAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem remover documentos.');
  const sourceId = String(formData.get('sourceId') ?? '');
  if (!sourceId) throw new Error('Documento inválido.');
  const db = await getDb();
  await deleteCompanySource(db, user.companyId, getEncryptionKey(), sourceId);
  revalidatePath('/company');
}
