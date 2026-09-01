'use server';

import { revalidatePath } from 'next/cache';
import type { CompanyProfile } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { saveCompanyProfile, loadCompanyProfile } from './company-profile';
import { deleteVoiceProfile } from './voice-profile';

export type VoiceRecognitionToggleState = { error?: string; ok?: string } | null;

/**
 * Liga/desliga o reconhecimento de voz ENTRE reuniões (Tier 3 — dado
 * biométrico, LGPD Art. 5º II) — opt-in, desligado por padrão. Desligado,
 * a pipeline de biometria inteira fica parada: zero captura de áudio extra,
 * zero chamada ao serviço de embedding, zero linha nova em `voice_profile`.
 */
export async function saveVoiceRecognitionToggleAction(
  _prev: VoiceRecognitionToggleState,
  formData: FormData,
): Promise<VoiceRecognitionToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem alterar esta configuração.' };

  const db = await getDb();
  const key = getEncryptionKey();
  const current = await loadCompanyProfile(db, user.companyId, key);
  const enabled = formData.get('voiceRecognitionEnabled') === '1';

  const profile: CompanyProfile = { ...current, voiceRecognitionEnabled: enabled };
  await saveCompanyProfile(db, user.companyId, key, profile);
  revalidatePath('/company');
  return {
    ok: enabled
      ? 'Reconhecimento de voz ligado — participantes precisam ser avisados.'
      : 'Reconhecimento de voz desligado.',
  };
}

export type DeleteVoiceProfileState = { error?: string; ok?: string } | null;

/** Direito de exclusão do titular (LGPD Art. 18) — apaga o perfil de voz de uma pessoa. */
export async function deleteVoiceProfileAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem remover perfis de voz.');
  const profileId = String(formData.get('profileId') ?? '');
  if (!profileId) throw new Error('Perfil inválido.');
  const db = await getDb();
  await deleteVoiceProfile(db, user.companyId, profileId);
  revalidatePath('/company');
}
