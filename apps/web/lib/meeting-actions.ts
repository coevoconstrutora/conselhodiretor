'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createMeeting, confirmRecording, revokeRecording, type MeetingGuidanceInput } from '@conselho/meetings';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { extractUploadedFileText } from './text-extract';

export type StartMeetingState = { error?: string } | null;

/**
 * Cria uma reunião (gravação NÃO confirmada — default NEGA) e navega para a
 * sala. Aceita opcionalmente um arquivo de pauta/roteiro (Etapa "guia de
 * reunião") — vira contexto extra para os conselheiros, cifrado como o título.
 */
export async function startMeetingAction(
  _prev: StartMeetingState,
  formData: FormData,
): Promise<StartMeetingState> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canWrite(user)) return { error: 'Convidados não podem criar reuniões.' };
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { error: 'Informe o título da reunião.' };
  const meetingTypeId = String(formData.get('meetingTypeId') ?? '').trim() || null;

  let guidance: MeetingGuidanceInput | null = null;
  const file = formData.get('guidanceFile');
  if (file instanceof File && file.size > 0) {
    try {
      guidance = { content: await extractUploadedFileText(file), filename: file.name };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Falha ao ler o arquivo de pauta.' };
    }
  }

  const db = await getDb();
  const meetingId = await createMeeting(
    db,
    user.id,
    user.companyId,
    title,
    getEncryptionKey(),
    meetingTypeId,
    guidance,
  );
  redirect(`/meetings/${meetingId}`);
}

/** Confirma a gravação (participantes cientes) — gate de servidor. */
export async function confirmRecordingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canWrite(user)) throw new Error('Convidados não podem confirmar gravação.');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const rawCount = String(formData.get('participantCount') ?? '').trim();
  const participantCount = rawCount ? Math.max(1, Math.min(100, Number(rawCount) || 0)) : undefined;
  const db = await getDb();
  await confirmRecording(db, meetingId, user.companyId, participantCount);
  revalidatePath(`/meetings/${meetingId}`);
}

/** Revoga a confirmação de gravação — o gate volta a negar. */
export async function revokeRecordingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canWrite(user)) throw new Error('Convidados não podem revogar gravação.');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const db = await getDb();
  await revokeRecording(db, meetingId, user.companyId);
  revalidatePath(`/meetings/${meetingId}`);
}
