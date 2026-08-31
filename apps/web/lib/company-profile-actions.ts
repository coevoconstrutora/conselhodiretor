'use server';

import { revalidatePath } from 'next/cache';
import type { CompanyProfile } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { saveCompanyProfile, addCompanySource, deleteCompanySource } from './company-profile';
import { fetchUrlText } from './kb-sources';

export type CompanyProfileActionState = { error?: string; ok?: string } | null;

/** Salva o perfil da empresa — vale imediatamente para os 9 conselheiros (sem restart). */
export async function saveCompanyProfileAction(
  _prev: CompanyProfileActionState,
  formData: FormData,
): Promise<CompanyProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar o perfil da empresa.' };

  const profile: CompanyProfile = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    size: String(formData.get('size') ?? '').trim() || undefined,
    segment: String(formData.get('segment') ?? '').trim() || undefined,
    region: String(formData.get('region') ?? '').trim() || undefined,
    notes: String(formData.get('notes') ?? '').trim() || undefined,
  };

  const db = await getDb();
  await saveCompanyProfile(db, user.companyId, getEncryptionKey(), profile);
  revalidatePath('/company');
  revalidatePath('/');
  return { ok: 'Perfil da empresa salvo — já vale para os 9 conselheiros.' };
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
    return { ok: 'Texto adicionado — já vale para os 9 conselheiros.' };
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
    return { ok: `Link importado ("${title}") — já vale para os 9 conselheiros.` };
  } catch (err) {
    console.error('[empresa] importar URL falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao importar a URL.' };
  }
}

const TEXT_FILE_RE = /\.(txt|md|markdown|csv)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB de texto puro

/** Adiciona conhecimento por ARQUIVO (.txt/.md/.csv — texto puro). */
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
      return { error: 'Selecione um arquivo .txt, .md ou .csv.' };
    if (!TEXT_FILE_RE.test(file.name))
      return {
        error:
          'Formato não suportado. Envie .txt, .md ou .csv — para PDF/Word, copie o texto e use "Colar texto".',
      };
    if (file.size > MAX_FILE_BYTES) return { error: 'Arquivo grande demais (máx. 2 MB de texto).' };
    const content = (await file.text()).trim();
    if (content.length < 20) return { error: 'O arquivo não tem texto útil.' };
    const db = await getDb();
    await addCompanySource(db, user.companyId, getEncryptionKey(), {
      kind: 'file',
      title: file.name,
      ref: file.name,
      content,
    });
    revalidatePath('/company');
    return { ok: `Arquivo "${file.name}" adicionado — já vale para os 9 conselheiros.` };
  } catch (err) {
    console.error('[empresa] upload falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada no upload.' };
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
