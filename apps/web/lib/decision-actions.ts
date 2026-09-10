'use server';

import { revalidatePath } from 'next/cache';
import {
  updateDecisionStatus,
  updateActionItemStatus,
  type DecisionStatus,
  type ActionItemStatus,
} from '@conselho/meeting-report';
import { meetingBelongsToCompany } from '@conselho/meetings';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';

const DECISION_STATUSES = new Set<DecisionStatus>(['decidido', 'recomendado', 'pendente', 'cancelado']);
const ACTION_ITEM_STATUSES = new Set<ActionItemStatus>(['pendente', 'concluida']);

/**
 * "Itens monitorados" (Etapa "Acompanhamento") — muda o status de uma
 * decisão/ação À MÃO, direto na aba da reunião. Fica marcado
 * `manuallyEdited` e sobrevive à próxima regeneração dos relatórios (ver
 * `saveMeetingOutcome`/`findManualMatch` em `packages/meeting-report`).
 */
export async function updateDecisionStatusAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem editar decisões.');
  const meetingId = String(formData.get('meetingId') ?? '');
  const decisionId = String(formData.get('decisionId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!meetingId || !decisionId) throw new Error('Dados incompletos.');
  if (!DECISION_STATUSES.has(status as DecisionStatus)) throw new Error('Status inválido.');
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) throw new Error('Reunião não encontrada.');
  await updateDecisionStatus(db, decisionId, status as DecisionStatus);
  revalidatePath(`/meetings/${meetingId}`);
}

export async function updateActionItemStatusAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem editar ações.');
  const meetingId = String(formData.get('meetingId') ?? '');
  const actionItemId = String(formData.get('actionItemId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!meetingId || !actionItemId) throw new Error('Dados incompletos.');
  if (!ACTION_ITEM_STATUSES.has(status as ActionItemStatus)) throw new Error('Status inválido.');
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) throw new Error('Reunião não encontrada.');
  await updateActionItemStatus(db, actionItemId, status as ActionItemStatus);
  revalidatePath(`/meetings/${meetingId}`);
}
