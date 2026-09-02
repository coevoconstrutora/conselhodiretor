import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { stripJsonFences, type ILlmProvider } from '@conselho/providers';

/**
 * Decision Ledger + Ações (Etapa "Histórico de reuniões", Seções 5/7) —
 * extraídos por IA UMA VEZ, junto com a síntese final do Presidente (mesma
 * chamada de trabalho, não uma chamada nova por reunião aberta). Mesmo
 * padrão defensivo de parse do CaseState/CaseReview: JSON malformado nunca
 * derruba a geração dos relatórios — apenas fica sem Decisões/Ações.
 */

export type DecisionStatus = 'decidido' | 'recomendado' | 'pendente' | 'cancelado';

const DECISION_STATUSES = new Set<DecisionStatus>(['decidido', 'recomendado', 'pendente', 'cancelado']);

export const DECISION_EXTRACTION_SYSTEM =
  'Você lê a síntese executiva final de uma reunião de conselho de uma incorporadora imobiliária e ' +
  'extrai, de forma ESTRUTURADA, as decisões e ações mencionadas — sem inventar nada que o texto não ' +
  'sustente. Regras: (1) DECIDIDO só quando o texto afirma que algo foi de fato decidido; ' +
  '(2) RECOMENDADO quando um conselheiro sugeriu mas ninguém decidiu; (3) PENDENTE quando ainda ' +
  'precisa de decisão; (4) CANCELADO quando o texto diz que algo foi descartado; nunca converta uma ' +
  'recomendação em decisão. Responda APENAS com JSON válido (sem cercas de código), no formato: ' +
  '{"decisions":[{"topic":"...","decision":"...","status":"decidido|recomendado|pendente|cancelado",' +
  '"responsible":"...","deadline":"YYYY-MM-DD ou null","evidence":"..."}],' +
  '"actionItems":[{"action":"...","responsible":"...","deadline":"YYYY-MM-DD ou null",' +
  '"relatedDecisionTopic":"... ou null"}]}. ' +
  'Campos sem informação no texto: "responsible" e "evidence" viram string vazia, "deadline" vira null. ' +
  'Se não houver nenhuma decisão nem ação identificável, responda {"decisions":[],"actionItems":[]}.';

export interface ExtractedDecision {
  readonly topic: string;
  readonly decision: string;
  readonly status: DecisionStatus;
  readonly responsible: string;
  readonly deadline: string | null;
  readonly evidence: string;
}

export interface ExtractedActionItem {
  readonly action: string;
  readonly responsible: string;
  readonly deadline: string | null;
  readonly relatedDecisionTopic: string | null;
}

export interface ExtractedMeetingOutcome {
  readonly decisions: readonly ExtractedDecision[];
  readonly actionItems: readonly ExtractedActionItem[];
}

function parseDeadline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Parse DEFENSIVO — malformado/parcial nunca derruba a geração dos relatórios. */
export function parseExtractedOutcome(raw: string): ExtractedMeetingOutcome | null {
  try {
    const obj = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    const decisions = Array.isArray(obj.decisions)
      ? (obj.decisions as Record<string, unknown>[]).flatMap((d): ExtractedDecision[] => {
          const topic = typeof d.topic === 'string' ? d.topic.trim() : '';
          const decision = typeof d.decision === 'string' ? d.decision.trim() : '';
          if (!topic || !decision) return [];
          return [
            {
              topic,
              decision,
              status: DECISION_STATUSES.has(d.status as DecisionStatus) ? (d.status as DecisionStatus) : 'pendente',
              responsible: typeof d.responsible === 'string' ? d.responsible.trim() : '',
              deadline: parseDeadline(d.deadline),
              evidence: typeof d.evidence === 'string' ? d.evidence.trim() : '',
            },
          ];
        })
      : [];
    const actionItems = Array.isArray(obj.actionItems)
      ? (obj.actionItems as Record<string, unknown>[]).flatMap((a): ExtractedActionItem[] => {
          const action = typeof a.action === 'string' ? a.action.trim() : '';
          if (!action) return [];
          return [
            {
              action,
              responsible: typeof a.responsible === 'string' ? a.responsible.trim() : '',
              deadline: parseDeadline(a.deadline),
              relatedDecisionTopic:
                typeof a.relatedDecisionTopic === 'string' && a.relatedDecisionTopic.trim()
                  ? a.relatedDecisionTopic.trim()
                  : null,
            },
          ];
        })
      : [];
    return { decisions, actionItems };
  } catch {
    return null;
  }
}

/**
 * Extrai Decisões/Ações da síntese final (Seção 7) — 1 chamada de texto
 * livre, mesmo modelo/raciocínio da síntese (já carregado pelo chamador).
 * Nunca lança: falha de LLM/parse devolve `null` (relatórios seguem sem
 * Decisões/Ações, nunca travam por causa disto).
 */
export async function extractMeetingOutcome(
  llm: ILlmProvider,
  presidentSynthesisText: string,
  modelOverride?: string,
  reasoningEffortOverride?: string,
): Promise<ExtractedMeetingOutcome | null> {
  if (typeof llm.completeText !== 'function') return null;
  try {
    const res = await llm.completeText({
      system: DECISION_EXTRACTION_SYSTEM,
      prompt: `Síntese final da reunião:\n\n${presidentSynthesisText}`,
      maxTokens: 800,
      model: modelOverride,
      reasoningEffort: reasoningEffortOverride,
    });
    return parseExtractedOutcome(res.text);
  } catch {
    return null;
  }
}

/** Persiste o resultado da extração — substitui qualquer extração anterior desta reunião (regenerar relatórios reextrai). */
export async function saveMeetingOutcome(
  db: SqlExecutor,
  meetingId: string,
  outcome: ExtractedMeetingOutcome,
  encryptionKey: Buffer,
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'meeting-outcome-extracted', kbSources: [], modelVersion: 'unknown' },
    async (tx) => {
      await tx.query('DELETE FROM meeting_action_item WHERE meeting_id = $1', [meetingId]);
      await tx.query('DELETE FROM meeting_decision WHERE meeting_id = $1', [meetingId]);
      const topicToId = new Map<string, string>();
      for (const d of outcome.decisions) {
        const res = await tx.query<{ id: string }>(
          `INSERT INTO meeting_decision (meeting_id, status, deadline, content_enc) VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            meetingId,
            d.status,
            d.deadline,
            encryptField(JSON.stringify({ topic: d.topic, decision: d.decision, responsible: d.responsible, evidence: d.evidence }), encryptionKey),
          ],
        );
        topicToId.set(d.topic, res.rows[0]!.id);
      }
      for (const a of outcome.actionItems) {
        const decisionId = a.relatedDecisionTopic ? (topicToId.get(a.relatedDecisionTopic) ?? null) : null;
        await tx.query(
          `INSERT INTO meeting_action_item (meeting_id, decision_id, deadline, content_enc) VALUES ($1, $2, $3, $4)`,
          [
            meetingId,
            decisionId,
            a.deadline,
            encryptField(JSON.stringify({ action: a.action, responsible: a.responsible }), encryptionKey),
          ],
        );
      }
      return null;
    },
  );
}

export interface MeetingDecisionRecord {
  readonly id: string;
  readonly topic: string;
  readonly decision: string;
  readonly status: DecisionStatus;
  readonly responsible: string;
  readonly deadline: Date | null;
  readonly evidence: string;
  readonly createdAt: Date;
}

export interface MeetingActionItemRecord {
  readonly id: string;
  readonly decisionId: string | null;
  readonly action: string;
  readonly responsible: string;
  readonly deadline: Date | null;
  readonly createdAt: Date;
}

export async function listMeetingDecisions(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<MeetingDecisionRecord[]> {
  const res = await db.query<{
    id: string;
    status: DecisionStatus;
    deadline: Date | string | null;
    content_enc: string;
    created_at: Date | string;
  }>('SELECT id, status, deadline, content_enc, created_at FROM meeting_decision WHERE meeting_id = $1 ORDER BY created_at ASC', [
    meetingId,
  ]);
  return res.rows.flatMap((r) => {
    try {
      const parsed = JSON.parse(decryptField(r.content_enc, encryptionKey)) as {
        topic: string;
        decision: string;
        responsible: string;
        evidence: string;
      };
      return [
        {
          id: r.id,
          topic: parsed.topic,
          decision: parsed.decision,
          status: r.status,
          responsible: parsed.responsible,
          deadline: r.deadline ? new Date(r.deadline) : null,
          evidence: parsed.evidence,
          createdAt: new Date(r.created_at),
        },
      ];
    } catch {
      return [];
    }
  });
}

export async function listMeetingActionItems(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<MeetingActionItemRecord[]> {
  const res = await db.query<{
    id: string;
    decision_id: string | null;
    deadline: Date | string | null;
    content_enc: string;
    created_at: Date | string;
  }>(
    'SELECT id, decision_id, deadline, content_enc, created_at FROM meeting_action_item WHERE meeting_id = $1 ORDER BY created_at ASC',
    [meetingId],
  );
  return res.rows.flatMap((r) => {
    try {
      const parsed = JSON.parse(decryptField(r.content_enc, encryptionKey)) as { action: string; responsible: string };
      return [
        {
          id: r.id,
          decisionId: r.decision_id,
          action: parsed.action,
          responsible: parsed.responsible,
          deadline: r.deadline ? new Date(r.deadline) : null,
          createdAt: new Date(r.created_at),
        },
      ];
    } catch {
      return [];
    }
  });
}
