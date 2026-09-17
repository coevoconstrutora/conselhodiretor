import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { stripJsonFences, type ILlmProvider } from '@conselho/providers';
import { keywordSet, jaccard } from '@conselho/engines';

/**
 * Decision Ledger + Ações (Etapa "Histórico de reuniões", Seções 5/7) —
 * extraídos por IA UMA VEZ, junto com a síntese final do Presidente (mesma
 * chamada de trabalho, não uma chamada nova por reunião aberta). Mesmo
 * padrão defensivo de parse do CaseState/CaseReview: JSON malformado nunca
 * derruba a geração dos relatórios — apenas fica sem Decisões/Ações.
 *
 * "Itens monitorados" (Etapa "Acompanhamento"): o dono pode marcar status À
 * MÃO (`updateDecisionStatus`/`updateActionItemStatus`, `manuallyEdited`
 * fica true). Regenerar relatórios reextrai tudo do zero via
 * `saveMeetingOutcome` — para não perder o que foi marcado à mão, o item
 * novo é casado por similaridade de texto (Jaccard sobre keywords, mesma
 * lógica do dedup semântico do board) contra os itens JÁ editados
 * manualmente daquela reunião; havendo casamento, o status manual sobrevive
 * em vez de ser sobrescrito pela extração nova.
 */

export type DecisionStatus = 'decidido' | 'recomendado' | 'pendente' | 'cancelado';
export type ActionItemStatus = 'pendente' | 'concluida';

const DECISION_STATUSES = new Set<DecisionStatus>(['decidido', 'recomendado', 'pendente', 'cancelado']);
const ACTION_ITEM_STATUSES = new Set<ActionItemStatus>(['pendente', 'concluida']);

/** Score mínimo (Jaccard sobre keywords normalizadas) pra considerar "o mesmo item" entre regenerações. */
const MANUAL_MATCH_THRESHOLD = 0.5;

interface ManuallyEditedItem<S extends string> {
  readonly text: string;
  readonly status: S;
}

/** Casa um item recém-extraído contra o pool de itens editados à mão — null se nenhum passar do limiar. */
function findManualMatch<S extends string>(
  candidateText: string,
  pool: readonly ManuallyEditedItem<S>[],
): S | null {
  if (pool.length === 0) return null;
  const candidateWords = keywordSet(candidateText);
  let bestStatus: S | null = null;
  let bestScore = MANUAL_MATCH_THRESHOLD;
  for (const item of pool) {
    const score = jaccard(candidateWords, keywordSet(item.text));
    if (score >= bestScore) {
      bestScore = score;
      bestStatus = item.status;
    }
  }
  return bestStatus;
}

export const DECISION_EXTRACTION_SYSTEM =
  'Você lê a síntese executiva final de uma reunião de conselho de uma incorporadora imobiliária — e, ' +
  'quando fornecida, a transcrição bruta da reunião — e extrai, de forma ESTRUTURADA, as decisões e ' +
  'ações mencionadas — sem inventar nada que o texto não sustente. Regras: (1) DECIDIDO só quando o ' +
  'texto afirma que algo foi de fato decidido; (2) RECOMENDADO quando um conselheiro sugeriu mas ' +
  'ninguém decidiu; (3) PENDENTE quando ainda precisa de decisão; (4) CANCELADO quando o texto diz ' +
  'que algo foi descartado; nunca converta uma recomendação em decisão. Para "responsible": a síntese ' +
  'executiva raramente cita nomes de pessoas — SEMPRE cheque a transcrição em busca de quem foi ' +
  'designado ou se ofereceu para cada ação/decisão (ex.: "fulano vai cuidar disso", "combinado, ' +
  'eu assumo") antes de deixar o campo vazio. Responda APENAS com JSON válido (sem cercas de código), ' +
  'no formato: {"decisions":[{"topic":"...","decision":"...",' +
  '"status":"decidido|recomendado|pendente|cancelado",' +
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
  } catch (error) {
    console.error('[relatorios] parse de decisões/ações falhou (resposta do LLM não é JSON válido):', error);
    return null;
  }
}

/**
 * Extrai Decisões/Ações da síntese final (Seção 7) — 1 chamada de texto
 * livre, mesmo modelo/raciocínio da síntese (já carregado pelo chamador).
 * Nunca lança: falha de LLM/parse devolve `null` (relatórios seguem sem
 * Decisões/Ações, nunca travam por causa disto).
 *
 * `transcriptFinals` (opcional): a síntese do Presidente é um resumo executivo
 * e quase nunca cita nomes de pessoas — só a transcrição bruta tem isso. Sem
 * ela, o campo "responsible" sai vazio quase sempre (mesma razão pela qual só
 * a Ata da Secretária, que recebe a transcrição, consegue citar responsáveis).
 */
export async function extractMeetingOutcome(
  llm: ILlmProvider,
  presidentSynthesisText: string,
  modelOverride?: string,
  reasoningEffortOverride?: string,
  transcriptFinals?: readonly string[],
): Promise<ExtractedMeetingOutcome | null> {
  if (typeof llm.completeText !== 'function') return null;
  try {
    const transcriptBlock =
      transcriptFinals && transcriptFinals.length > 0
        ? `Transcrição da reunião:\n${transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n`
        : '';
    const res = await llm.completeText({
      system: DECISION_EXTRACTION_SYSTEM,
      prompt: `${transcriptBlock}Síntese final da reunião:\n\n${presidentSynthesisText}`,
      // 800 (e depois 4000) cortava a resposta (JSON vazio, sem erro de
      // API) com reasoningEffort 'high'/'xhigh' — em modelos de raciocínio
      // o teto cobre raciocínio interno + texto visível junto, e reunião
      // longa consome ainda mais raciocínio. 12000 é o valor usado em TODAS
      // as outras chamadas deste mesmo nível de raciocínio (ver
      // apps/web/lib/report-actions.ts, createLlm({ maxTokens: 12000 })) —
      // confirmado em produção: falhou 2x com 4000 numa reunião longa
      // (OpenAiLlmError 'Resposta sem conteúdo').
      maxTokens: 12000,
      model: modelOverride,
      reasoningEffort: reasoningEffortOverride,
    });
    return parseExtractedOutcome(res.text);
  } catch (error) {
    console.error('[relatorios] extração de decisões/ações falhou (chamada ao LLM):', error);
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
      // Pool de status editados À MÃO (Etapa "Acompanhamento") — lido ANTES do
      // DELETE, pra casar contra os itens recém-extraídos e preservar o que o
      // dono já marcou (ex.: ação concluída) em vez de perder na regeneração.
      const manualDecisions = await tx.query<{ content_enc: string; status: DecisionStatus }>(
        'SELECT content_enc, status FROM meeting_decision WHERE meeting_id = $1 AND manually_edited = true',
        [meetingId],
      );
      const manualDecisionPool: ManuallyEditedItem<DecisionStatus>[] = manualDecisions.rows.flatMap((r) => {
        try {
          const parsed = JSON.parse(decryptField(r.content_enc, encryptionKey)) as { topic: string; decision: string };
          return [{ text: `${parsed.topic} ${parsed.decision}`, status: r.status }];
        } catch {
          return [];
        }
      });
      const manualActions = await tx.query<{ content_enc: string; status: ActionItemStatus }>(
        'SELECT content_enc, status FROM meeting_action_item WHERE meeting_id = $1 AND manually_edited = true',
        [meetingId],
      );
      const manualActionPool: ManuallyEditedItem<ActionItemStatus>[] = manualActions.rows.flatMap((r) => {
        try {
          const parsed = JSON.parse(decryptField(r.content_enc, encryptionKey)) as { action: string };
          return [{ text: parsed.action, status: r.status }];
        } catch {
          return [];
        }
      });

      await tx.query('DELETE FROM meeting_action_item WHERE meeting_id = $1', [meetingId]);
      await tx.query('DELETE FROM meeting_decision WHERE meeting_id = $1', [meetingId]);
      const topicToId = new Map<string, string>();
      for (const d of outcome.decisions) {
        const manualStatus = findManualMatch(`${d.topic} ${d.decision}`, manualDecisionPool);
        const res = await tx.query<{ id: string }>(
          `INSERT INTO meeting_decision (meeting_id, status, deadline, content_enc, manually_edited)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            meetingId,
            manualStatus ?? d.status,
            d.deadline,
            encryptField(JSON.stringify({ topic: d.topic, decision: d.decision, responsible: d.responsible, evidence: d.evidence }), encryptionKey),
            manualStatus !== null,
          ],
        );
        topicToId.set(d.topic, res.rows[0]!.id);
      }
      for (const a of outcome.actionItems) {
        const decisionId = a.relatedDecisionTopic ? (topicToId.get(a.relatedDecisionTopic) ?? null) : null;
        const manualStatus = findManualMatch(a.action, manualActionPool);
        await tx.query(
          `INSERT INTO meeting_action_item (meeting_id, decision_id, deadline, content_enc, status, manually_edited)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            meetingId,
            decisionId,
            a.deadline,
            encryptField(JSON.stringify({ action: a.action, responsible: a.responsible }), encryptionKey),
            manualStatus ?? 'pendente',
            manualStatus !== null,
          ],
        );
      }
      return null;
    },
  );
}

/** "Marcar concluída"/reabrir uma ação, ou mudar o status de uma decisão à mão — nunca sobrescrito na próxima regeneração sem casar por texto. */
export async function updateDecisionStatus(db: SqlExecutor, decisionId: string, status: DecisionStatus): Promise<void> {
  if (!DECISION_STATUSES.has(status)) throw new Error(`Status de decisão inválido: ${status}`);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'decision-status-edit', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('UPDATE meeting_decision SET status = $2, manually_edited = true WHERE id = $1', [decisionId, status]);
      return null;
    },
  );
}

export async function updateActionItemStatus(db: SqlExecutor, actionItemId: string, status: ActionItemStatus): Promise<void> {
  if (!ACTION_ITEM_STATUSES.has(status)) throw new Error(`Status de ação inválido: ${status}`);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'action-item-status-edit', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('UPDATE meeting_action_item SET status = $2, manually_edited = true WHERE id = $1', [actionItemId, status]);
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
  /** Status setado à mão (via `updateDecisionStatus`) — sobrevive à próxima regeneração se o texto casar. */
  readonly manuallyEdited: boolean;
  readonly createdAt: Date;
}

export interface MeetingActionItemRecord {
  readonly id: string;
  readonly decisionId: string | null;
  readonly action: string;
  readonly responsible: string;
  readonly deadline: Date | null;
  readonly status: ActionItemStatus;
  /** Status setado à mão (via `updateActionItemStatus`) — sobrevive à próxima regeneração se o texto casar. */
  readonly manuallyEdited: boolean;
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
    manually_edited: boolean;
    created_at: Date | string;
  }>(
    'SELECT id, status, deadline, content_enc, manually_edited, created_at FROM meeting_decision WHERE meeting_id = $1 ORDER BY created_at ASC',
    [meetingId],
  );
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
          manuallyEdited: r.manually_edited,
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
    status: ActionItemStatus;
    manually_edited: boolean;
    created_at: Date | string;
  }>(
    'SELECT id, decision_id, deadline, content_enc, status, manually_edited, created_at FROM meeting_action_item WHERE meeting_id = $1 ORDER BY created_at ASC',
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
          status: r.status,
          manuallyEdited: r.manually_edited,
          createdAt: new Date(r.created_at),
        },
      ];
    } catch {
      return [];
    }
  });
}
