'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import {
  createParticipant,
  updateParticipant,
  setParticipantStatus,
  getParticipant,
  type ParticipantInput,
} from './participants';
import type { SqlExecutor } from '@conselho/db';
import type { CurrentUser } from './auth';
import { VOICE_REQUIRED_SAMPLES } from './voice-quality';
import { grantBiometricConsent, revokeBiometricConsent, hasActiveConsent } from './biometric-consent';
import {
  enrollParticipantVoice,
  revokeParticipantVoice,
  deleteParticipantVoice,
  type VoiceSample,
} from './voice-profile';

export type ParticipantActionState = { error?: string; ok?: string } | null;

/**
 * Quem pode mexer na biometria de um participante: admin/gestor (qualquer
 * participante DA EMPRESA ATIVA) OU a própria pessoa — o participante
 * vinculado à conta dela ("Meu perfil"), inclusive convidado. Sempre
 * escopado à empresa ativa: um participantId de outra empresa é "não encontrado".
 */
async function resolveVoiceTarget(
  db: SqlExecutor,
  user: CurrentUser,
  participantId: string,
): Promise<{ participant: NonNullable<Awaited<ReturnType<typeof getParticipant>>>; self: boolean } | { error: string }> {
  const participant = await getParticipant(db, user.companyId, participantId);
  if (!participant) return { error: 'Participante não encontrado.' };
  const self = participant.appUserId === user.id;
  if (!self && !canWrite(user)) return { error: 'Convidados não podem gerenciar biometria.' };
  return { participant, self };
}

function parseParticipantInput(formData: FormData): ParticipantInput {
  return {
    name: String(formData.get('name') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim() || null,
    jobTitle: String(formData.get('jobTitle') ?? '').trim() || null,
    department: String(formData.get('department') ?? '').trim() || null,
    companyName: String(formData.get('companyName') ?? '').trim() || null,
  };
}

export async function createParticipantAction(
  _prev: ParticipantActionState,
  formData: FormData,
): Promise<ParticipantActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem gerenciar participantes.' };
  try {
    const db = await getDb();
    const participant = await createParticipant(db, user.companyId, parseParticipantInput(formData));
    revalidatePath('/participants');
    return { ok: `Participante "${participant.name}" criado — configure a biometria em /participants/${participant.id}.` };
  } catch (err) {
    console.error('[participantes] criar falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao criar o participante.' };
  }
}

export async function updateParticipantAction(
  _prev: ParticipantActionState,
  formData: FormData,
): Promise<ParticipantActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem gerenciar participantes.' };
  const participantId = String(formData.get('participantId') ?? '');
  if (!participantId) return { error: 'Participante inválido.' };
  try {
    const db = await getDb();
    await updateParticipant(db, user.companyId, participantId, parseParticipantInput(formData));
    revalidatePath(`/participants/${participantId}`);
    revalidatePath('/participants');
    return { ok: 'Dados do participante atualizados.' };
  } catch (err) {
    console.error('[participantes] editar falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao editar o participante.' };
  }
}

/** Ativar/desativar — nunca exclusão física (preserva histórico). */
export async function setParticipantStatusAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem gerenciar participantes.');
  const participantId = String(formData.get('participantId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!participantId || (status !== 'active' && status !== 'inactive')) throw new Error('Dados inválidos.');
  const db = await getDb();
  await setParticipantStatus(db, user.companyId, participantId, status);
  revalidatePath(`/participants/${participantId}`);
  revalidatePath('/participants');
}

/**
 * Etapa 1 do assistente "Cadastrar voz" (Seção 6/7) — checkbox NUNCA
 * pré-marcado no cliente; aqui só validamos que veio marcado e registramos
 * o consentimento auditável ANTES de qualquer captura de áudio.
 */
export async function grantVoiceConsentAction(
  _prev: ParticipantActionState,
  formData: FormData,
): Promise<ParticipantActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  const participantId = String(formData.get('participantId') ?? '');
  const consented = formData.get('consent') === 'on';
  if (!participantId) return { error: 'Participante inválido.' };
  if (!consented) return { error: 'É necessário marcar o consentimento para continuar.' };
  try {
    const db = await getDb();
    const target = await resolveVoiceTarget(db, user, participantId);
    if ('error' in target) return { error: target.error };
    await grantBiometricConsent(db, participantId, user.id, target.self ? 'self_enrollment' : 'admin_enrollment');
    revalidatePath(`/participants/${participantId}`);
    revalidatePath('/profile');
    return { ok: 'Consentimento registrado.' };
  } catch (err) {
    console.error('[biometria] registrar consentimento falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha ao registrar o consentimento.' };
  }
}

export type VoiceEnrollmentState = { error?: string; ok?: string; qualityScore?: number } | null;

/**
 * Etapas 3-6 do assistente: recebe as amostras JÁ gravadas pelo navegador
 * (multipart — sem frase secreta, fala natural) e gera o template biométrico.
 * Falha em QUALQUER amostra aborta o cadastro inteiro (Seção 7 — nunca cria
 * o perfil com qualidade insuficiente). O áudio bruto nunca é persistido —
 * só passa por memória neste processo, e é descartado ao final desta função.
 */
export async function enrollParticipantVoiceAction(
  _prev: VoiceEnrollmentState,
  formData: FormData,
): Promise<VoiceEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  const participantId = String(formData.get('participantId') ?? '');
  if (!participantId) return { error: 'Participante inválido.' };

  try {
    const db = await getDb();
    const target = await resolveVoiceTarget(db, user, participantId);
    if ('error' in target) return { error: target.error };
    // nome/área vêm do cadastro (banco), nunca do formulário do cliente
    const participantName = target.participant.name;
    const participantArea = target.participant.department;
    if (!(await hasActiveConsent(db, participantId))) {
      return { error: 'Consentimento de biometria de voz ausente ou revogado — registre o consentimento antes de gravar.' };
    }

    const samples: VoiceSample[] = [];
    for (let i = 0; i < VOICE_REQUIRED_SAMPLES; i++) {
      const file = formData.get(`sample${i}`);
      const durationMs = Number(formData.get(`sample${i}DurationMs`) ?? '0');
      if (!(file instanceof File) || file.size === 0) continue;
      const audio = Buffer.from(await file.arrayBuffer());
      samples.push({ audio, mimeType: file.type || 'audio/webm', durationMs });
    }
    if (samples.length < VOICE_REQUIRED_SAMPLES) {
      return { error: `Grave as ${VOICE_REQUIRED_SAMPLES} amostras de voz (2 rodadas) — se a tela estava aberta antes de uma atualização, recarregue a página.` };
    }

    const { qualityScore } = await enrollParticipantVoice(
      db,
      user.companyId,
      participantId,
      participantName,
      participantArea,
      samples,
      getEncryptionKey(),
    );
    revalidatePath(`/participants/${participantId}`);
    revalidatePath('/profile');
    return { ok: 'Voz cadastrada com sucesso.', qualityScore };
  } catch (err) {
    console.error('[biometria] cadastro de voz falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao cadastrar a voz.' };
  }
}

/** "Revogar biometria" (Seção 28) — impede matching futuro, preserva auditoria. */
export async function revokeVoiceAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const participantId = String(formData.get('participantId') ?? '');
  if (!participantId) throw new Error('Participante inválido.');
  const db = await getDb();
  const target = await resolveVoiceTarget(db, user, participantId);
  if ('error' in target) throw new Error(target.error);
  await revokeParticipantVoice(db, user.companyId, participantId);
  await revokeBiometricConsent(db, participantId, user.id, target.self ? 'self_revocation' : 'admin_revocation');
  revalidatePath(`/participants/${participantId}`);
  revalidatePath('/profile');
}

/** "Excluir biometria" (Seção 29, LGPD Art. 18) — remove os templates; histórico de reuniões permanece. */
export async function deleteVoiceAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const participantId = String(formData.get('participantId') ?? '');
  if (!participantId) throw new Error('Participante inválido.');
  const db = await getDb();
  const target = await resolveVoiceTarget(db, user, participantId);
  if ('error' in target) throw new Error(target.error);
  await deleteParticipantVoice(db, user.companyId, participantId);
  revalidatePath(`/participants/${participantId}`);
  revalidatePath('/profile');
}
