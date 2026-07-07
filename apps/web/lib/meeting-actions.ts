'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createMeeting, confirmRecording, revokeRecording } from '@conselho/meetings';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';

/** Cria uma reunião (gravação NÃO confirmada — default NEGA) e navega para a sala. */
export async function startMeetingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const title = String(formData.get('title') ?? '').trim();
  if (!title) throw new Error('Informe o título da reunião.');
  const db = await getDb();
  const meetingId = await createMeeting(db, user.id, title, getEncryptionKey());
  redirect(`/meetings/${meetingId}`);
}

/** Confirma a gravação (participantes cientes) — gate de servidor. */
export async function confirmRecordingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const db = await getDb();
  await confirmRecording(db, meetingId);
  revalidatePath(`/meetings/${meetingId}`);
}

/** Revoga a confirmação de gravação — o gate volta a negar. */
export async function revokeRecordingAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const db = await getDb();
  await revokeRecording(db, meetingId);
  revalidatePath(`/meetings/${meetingId}`);
}
