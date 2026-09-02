import type { SqlExecutor } from '@conselho/db';
import { decryptField } from '@conselho/crypto';
import { listMeetingDecisions, listMeetingActionItems, type MeetingDecisionRecord, type MeetingActionItemRecord } from './decisions';

/**
 * Contexto ENTRE reuniões (Etapa "Histórico de reuniões", Seções 10/15) —
 * substitui a injeção AUTOMÁTICA das últimas 3 sínteses (comportamento
 * antigo, sem escolha do dono) por uma referência EXPLÍCITA e ESTRUTURADA a
 * UMA reunião anterior específica, escolhida ao criar a reunião nova.
 * Prefere o Decision Ledger/Ações (estruturado) sobre a transcrição crua —
 * a síntese do Presidente entra só como resumo textual.
 */

export interface PreviousMeetingContext {
  readonly meetingId: string;
  readonly title: string;
  readonly closedAt: Date | null;
  readonly summary: string | null;
  readonly decisions: readonly MeetingDecisionRecord[];
  readonly pendingDecisions: readonly MeetingDecisionRecord[];
  readonly actionItems: readonly MeetingActionItemRecord[];
}

/** `null` se a reunião não existir, não pertencer à empresa, ou não estiver encerrada. */
export async function loadPreviousMeetingContext(
  db: SqlExecutor,
  companyId: string,
  previousContextMeetingId: string,
  encryptionKey: Buffer,
): Promise<PreviousMeetingContext | null> {
  const res = await db.query<{ title_enc: string; closed_at: Date | string | null }>(
    `SELECT title_enc, closed_at FROM meeting WHERE id = $1 AND company_id = $2 AND status = 'closed'`,
    [previousContextMeetingId, companyId],
  );
  const row = res.rows[0];
  if (!row) return null;

  const reportRes = await db.query<{ content_enc: string }>(
    `SELECT content_enc FROM agent_report WHERE meeting_id = $1 AND agent_id = 'presidente'`,
    [previousContextMeetingId],
  );
  let summary: string | null = null;
  try {
    summary = reportRes.rows[0] ? decryptField(reportRes.rows[0].content_enc, encryptionKey) : null;
  } catch {
    summary = null;
  }

  const decisions = await listMeetingDecisions(db, previousContextMeetingId, encryptionKey);
  const actionItems = await listMeetingActionItems(db, previousContextMeetingId, encryptionKey);

  let title = 'Reunião anterior';
  try {
    title = decryptField(row.title_enc, encryptionKey);
  } catch {
    // título ilegível (chave rotacionada) — mantém o rótulo genérico
  }

  return {
    meetingId: previousContextMeetingId,
    title,
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    summary,
    decisions,
    pendingDecisions: decisions.filter((d) => d.status === 'pendente'),
    actionItems,
  };
}

export interface PreviousMeetingPreview {
  readonly meetingId: string;
  readonly title: string;
  readonly closedAt: Date;
  readonly decisionsCount: number;
  readonly pendingDecisionsCount: number;
  readonly actionItemsCount: number;
}

/**
 * Reunião mais recente ENCERRADA do MESMO tipo (Etapa "Histórico de
 * reuniões", Seção 10) — alimenta o bloco "Contexto da reunião anterior" no
 * formulário de nova reunião. `null` se não houver nenhuma (tipo novo, ou
 * nenhuma reunião deste tipo foi encerrada ainda). Só contagens (sem
 * decifrar linha por linha — mais barato para um preview).
 */
export async function findLatestClosedMeetingOfType(
  db: SqlExecutor,
  companyId: string,
  meetingTypeId: string,
  encryptionKey: Buffer,
): Promise<PreviousMeetingPreview | null> {
  const res = await db.query<{ id: string; title_enc: string; closed_at: Date | string }>(
    `SELECT id, title_enc, closed_at FROM meeting
     WHERE company_id = $1 AND meeting_type_id = $2 AND status = 'closed' AND closed_at IS NOT NULL
     ORDER BY closed_at DESC LIMIT 1`,
    [companyId, meetingTypeId],
  );
  const row = res.rows[0];
  if (!row) return null;
  let title = 'Reunião anterior';
  try {
    title = decryptField(row.title_enc, encryptionKey);
  } catch {
    // título ilegível — mantém o rótulo genérico, ainda mostra o preview
  }
  const decisionCounts = await db.query<{ total: string | number; pending: string | number }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'pendente') AS pending
     FROM meeting_decision WHERE meeting_id = $1`,
    [row.id],
  );
  const actionCounts = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) AS count FROM meeting_action_item WHERE meeting_id = $1',
    [row.id],
  );
  return {
    meetingId: row.id,
    title,
    closedAt: new Date(row.closed_at),
    decisionsCount: Number(decisionCounts.rows[0]?.total ?? 0),
    pendingDecisionsCount: Number(decisionCounts.rows[0]?.pending ?? 0),
    actionItemsCount: Number(actionCounts.rows[0]?.count ?? 0),
  };
}

/** Bloco de texto pronto para prefixar o CaseState (mesmo lugar de `meetingGuidance`). */
export function buildPreviousMeetingContextBlock(ctx: PreviousMeetingContext): string {
  const parts: string[] = [];
  if (ctx.summary) parts.push(`Resumo: ${ctx.summary}`);
  if (ctx.pendingDecisions.length) {
    parts.push(
      `Decisões PENDENTES: ${ctx.pendingDecisions.map((d) => `${d.topic} (${d.decision})`).join('; ')}.`,
    );
  }
  if (ctx.actionItems.length) {
    parts.push(`Ações em aberto: ${ctx.actionItems.map((a) => a.action).join('; ')}.`);
  }
  const closedLabel = ctx.closedAt ? ` (encerrada em ${ctx.closedAt.toLocaleDateString('pt-BR')})` : '';
  return (
    `CONTEXTO DA REUNIÃO ANTERIOR (${ctx.title}${closedLabel}) — escolhido explicitamente pelo dono ` +
    `para esta reunião; use como CONTINUIDADE, não repita o que já foi decidido, aponte quando um ` +
    `assunto retorna:\n${parts.join('\n')}`
  );
}
