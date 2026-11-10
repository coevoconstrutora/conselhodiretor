'use server';

import { revalidatePath } from 'next/cache';
import { setMeetingConfidential, shareMeeting, unshareMeeting } from '@conselho/meetings';
import { getCurrentUser } from './auth';
import { getDb } from './db';

/**
 * Confidencialidade e compartilhamento de uma reunião — SÓ o criador
 * (meeting.user_id) gerencia; o servidor confere o dono em cada operação,
 * nunca confia no cliente. Admin/gestor da empresa não têm exceção.
 */

export type MeetingAccessState = { error?: string; ok?: string } | null;

const SHARE_ERRORS = {
  not_owner: 'Só quem criou a reunião pode gerenciar o acesso a ela.',
  not_member: 'Essa pessoa não tem acesso a esta empresa.',
  self: 'Você já é o criador desta reunião.',
} as const;

export async function setMeetingConfidentialAction(
  _prev: MeetingAccessState,
  formData: FormData,
): Promise<MeetingAccessState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) return { error: 'Reunião inválida.' };
  const confidential = formData.get('confidential') === '1';
  try {
    const db = await getDb();
    const done = await setMeetingConfidential(db, meetingId, user.id, user.companyId, confidential);
    if (!done) return { error: SHARE_ERRORS.not_owner };
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath('/');
    return {
      ok: confidential
        ? 'Reunião confidencial: só você, quem esteve presente (com conta) e quem você convidar veem o conteúdo.'
        : 'Reunião aberta: toda a empresa volta a ver.',
    };
  } catch (err) {
    console.error('[reuniao] alterar confidencialidade falhou:', err);
    return { error: 'Falha inesperada — tente de novo.' };
  }
}

export async function shareMeetingAction(
  _prev: MeetingAccessState,
  formData: FormData,
): Promise<MeetingAccessState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  const meetingId = String(formData.get('meetingId') ?? '');
  const targetUserId = String(formData.get('userId') ?? '');
  if (!meetingId || !targetUserId) return { error: 'Escolha com quem compartilhar.' };
  try {
    const db = await getDb();
    const result = await shareMeeting(db, meetingId, user.id, user.companyId, targetUserId);
    if (result !== 'ok') return { error: SHARE_ERRORS[result] };
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath('/');
    return { ok: 'Reunião compartilhada.' };
  } catch (err) {
    console.error('[reuniao] compartilhar falhou:', err);
    return { error: 'Falha inesperada — tente de novo.' };
  }
}

export async function unshareMeetingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const meetingId = String(formData.get('meetingId') ?? '');
  const targetUserId = String(formData.get('userId') ?? '');
  if (!meetingId || !targetUserId) throw new Error('Dados inválidos.');
  const db = await getDb();
  const done = await unshareMeeting(db, meetingId, user.id, user.companyId, targetUserId);
  if (!done) throw new Error(SHARE_ERRORS.not_owner);
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/');
}
