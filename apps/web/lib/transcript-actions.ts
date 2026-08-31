'use server';

import { revalidatePath } from 'next/cache';
import { saveTranscriptReview } from '@conselho/meeting-report';
import { meetingBelongsToCompany } from '@conselho/meetings';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';

/**
 * Salva a transcrição corrigida pelo médico (Transcrição Confiável). A partir
 * daqui a nota clínica (E9) e o relatório nutricional (E13) nascem da versão
 * revisada. Cifrada + auditada no Documentation Service. Segue o padrão de
 * saveNoteAction (lança em erro — fluxo de baixo risco, form simples).
 */
export async function saveTranscriptReviewAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem editar a transcrição.');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const content = String(formData.get('content') ?? '').trim();
  if (!content) throw new Error('Transcrição vazia — não há o que salvar.');
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    throw new Error('Reunião não encontrada.');
  }
  await saveTranscriptReview(db, meetingId, content, getEncryptionKey());
  revalidatePath(`/meetings/${meetingId}`);
}
