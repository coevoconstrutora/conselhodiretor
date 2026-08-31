'use server';

import { revalidatePath } from 'next/cache';
import type { CompanyProfile } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { saveCompanyProfile } from './company-profile';

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
  await saveCompanyProfile(db, getEncryptionKey(), profile);
  revalidatePath('/company');
  revalidatePath('/');
  return { ok: 'Perfil da empresa salvo — já vale para os 9 conselheiros.' };
}
