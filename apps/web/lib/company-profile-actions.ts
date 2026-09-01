'use server';

import { revalidatePath } from 'next/cache';
import type { CompanyProfile } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { saveCompanyProfile, loadCompanyProfile, addCompanySource, deleteCompanySource } from './company-profile';
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

  const db = await getDb();
  const key = getEncryptionKey();
  // lê o que já existe primeiro — este form só conhece os campos de negócio;
  // sobrescrever o blob inteiro do zero apagaria logo/tema salvos à parte.
  const current = await loadCompanyProfile(db, user.companyId, key);
  const profile: CompanyProfile = {
    ...current,
    name: String(formData.get('name') ?? '').trim() || undefined,
    cnpj: String(formData.get('cnpj') ?? '').trim() || undefined,
    size: String(formData.get('size') ?? '').trim() || undefined,
    segment: String(formData.get('segment') ?? '').trim() || undefined,
    region: region.length > 0 ? region : undefined,
    notes: String(formData.get('notes') ?? '').trim() || undefined,
  };

  await saveCompanyProfile(db, user.companyId, key, profile);
  revalidatePath('/company');
  revalidatePath('/');
  return { ok: 'Perfil da empresa salvo — já vale para todos os conselheiros.' };
}

const MAX_LOGO_BYTES = 512 * 1024; // 512 KB — logo pequeno, sobra pro header
const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export type CompanyAppearanceState = { error?: string; ok?: string } | null;

/**
 * Logo + tema visual (cor do texto/título, fundo) — separado do perfil de
 * negócio de propósito (evita misturar "conteúdo pro board" com "aparência
 * da tela"). Mesmo padrão read-modify-write: só mexe nos campos que gerencia.
 */
export async function saveCompanyAppearanceAction(
  _prev: CompanyAppearanceState,
  formData: FormData,
): Promise<CompanyAppearanceState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar a aparência.' };

  const db = await getDb();
  const key = getEncryptionKey();
  const current = await loadCompanyProfile(db, user.companyId, key);

  let logoDataUrl = current.logoDataUrl ?? null;
  const file = formData.get('logo');
  if (formData.get('removeLogo') === '1') {
    logoDataUrl = null;
  } else if (file instanceof File && file.size > 0) {
    if (!LOGO_MIME_TYPES.has(file.type)) {
      return { error: 'Formato não suportado — envie PNG, JPEG, WebP ou SVG.' };
    }
    if (file.size > MAX_LOGO_BYTES) {
      return { error: `Arquivo grande demais (máx. ${Math.round(MAX_LOGO_BYTES / 1024)} KB).` };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    logoDataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
  }

  const textColorRaw = String(formData.get('themeTextColor') ?? '').trim();
  const titleColorRaw = String(formData.get('themeTitleColor') ?? '').trim();
  const themeTextColor = HEX_COLOR_RE.test(textColorRaw) ? textColorRaw : null;
  const themeTitleColor = HEX_COLOR_RE.test(titleColorRaw) ? titleColorRaw : null;
  const themeBackground = formData.get('themeBackground') === 'plain' ? 'plain' : 'grid';

  const profile: CompanyProfile = {
    ...current,
    logoDataUrl,
    themeTextColor,
    themeTitleColor,
    themeBackground,
  };
  await saveCompanyProfile(db, user.companyId, key, profile);
  revalidatePath('/company');
  revalidatePath('/');
  return { ok: 'Aparência salva — já vale na próxima página carregada.' };
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
    const added = await addCompanySource(db, user.companyId, getEncryptionKey(), { kind: 'text', title, content });
    revalidatePath('/company');
    return {
      ok: `Texto adicionado (${added.chars.toLocaleString('pt-BR')} caracteres) — já vale para todos os conselheiros.\n"${added.preview}"`,
    };
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
    const rescanDaysRaw = String(formData.get('rescanDays') ?? '').trim();
    const rescanDays = rescanDaysRaw ? Number(rescanDaysRaw) : null;
    const { title, text } = await fetchUrlText(url);
    const db = await getDb();
    const added = await addCompanySource(db, user.companyId, getEncryptionKey(), {
      kind: 'url',
      title,
      ref: url,
      content: text,
      rescanDays,
    });
    revalidatePath('/company');
    const rescanNote = rescanDays ? ` Revisão automática a cada ${rescanDays} dia(s).` : '';
    return {
      ok: `Link importado ("${title}", ${added.chars.toLocaleString('pt-BR')} caracteres) — já vale para todos os conselheiros.${rescanNote}\n"${added.preview}"`,
    };
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
    const added = await addCompanySource(db, user.companyId, getEncryptionKey(), {
      kind: 'file',
      title: file.name,
      ref: file.name,
      content,
    });
    revalidatePath('/company');
    return {
      ok: `Arquivo "${file.name}" adicionado (${added.chars.toLocaleString('pt-BR')} caracteres) — já vale para todos os conselheiros.\n"${added.preview}"`,
    };
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
