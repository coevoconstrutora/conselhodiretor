import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { stripJsonFences, type ILlmProvider, type AgentId } from '@conselho/providers';

/**
 * Experimentação controlada de IA (Etapa "Experimentação de IA") — REPLAY/
 * A-B de uma config candidata (modelo/raciocínio) de UM conselheiro ou da
 * síntese do Presidente contra reuniões históricas REAIS, sem tocar
 * produção. Reunião histórica é evidência IMUTÁVEL: nada aqui sobrescreve
 * `agent_report`/`meeting_improvement` — resultados vivem em tabelas
 * próprias (Seção 1/54 do pedido).
 *
 * Escopo desta entrega (ver relatório final): 1 dimensão por experimento
 * (modelo+raciocínio de 1 conselheiro OU da síntese do Presidente), rodado
 * SÍNCRONO sobre um número pequeno de reuniões (sem fila de jobs/shadow
 * testing ao vivo — infra nova e de maior risco, fica para depois).
 */

export type ExperimentTargetType = 'counselor' | 'president_synthesis';
export type ExperimentStatus = 'draft' | 'running' | 'completed' | 'failed' | 'promoted';
export type ExperimentResultLabel = 'recommended' | 'promising' | 'inconclusive' | 'not_recommended' | 'harmful';

export interface AiExperiment {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly objective: string | null;
  readonly targetType: ExperimentTargetType;
  readonly targetAgentId: AgentId | null;
  readonly baselineModel: string;
  readonly baselineReasoningEffort: string;
  readonly candidateModel: string;
  readonly candidateReasoningEffort: string;
  readonly status: ExperimentStatus;
  readonly result: ExperimentResultLabel | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly promotedAt: Date | null;
}

export interface CreateExperimentInput {
  readonly name: string;
  readonly objective: string | null;
  readonly targetType: ExperimentTargetType;
  readonly targetAgentId: AgentId | null;
  readonly baselineModel: string;
  readonly baselineReasoningEffort: string;
  readonly candidateModel: string;
  readonly candidateReasoningEffort: string;
}

export async function createExperiment(
  db: SqlExecutor,
  companyId: string,
  userId: string,
  input: CreateExperimentInput,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO ai_experiment
       (company_id, name, objective, target_type, target_agent_id, baseline_model,
        baseline_reasoning_effort, candidate_model, candidate_reasoning_effort, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      companyId,
      input.name.trim().slice(0, 160),
      input.objective?.trim().slice(0, 500) || null,
      input.targetType,
      input.targetAgentId,
      input.baselineModel,
      input.baselineReasoningEffort,
      input.candidateModel,
      input.candidateReasoningEffort,
      userId,
    ],
  );
  return res.rows[0]!.id;
}

export async function setExperimentStatus(db: SqlExecutor, experimentId: string, status: ExperimentStatus): Promise<void> {
  await db.query('UPDATE ai_experiment SET status = $2 WHERE id = $1', [experimentId, status]);
}

export async function completeExperiment(
  db: SqlExecutor,
  experimentId: string,
  result: ExperimentResultLabel,
): Promise<void> {
  await db.query(
    `UPDATE ai_experiment SET status = 'completed', result = $2, completed_at = now() WHERE id = $1`,
    [experimentId, result],
  );
}

/** "Aplicar em produção" (Seção 36) — cria uma NOVA versão de config real, nunca sobrescreve o experimento. */
export async function promoteExperiment(db: SqlExecutor, experimentId: string, userId: string): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'ai-experiment-promoted', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `UPDATE ai_experiment SET status = 'promoted', promoted_at = now(), promoted_by = $2 WHERE id = $1`,
        [experimentId, userId],
      );
      return null;
    },
  );
}

function toExperiment(row: {
  id: string;
  company_id: string;
  name: string;
  objective: string | null;
  target_type: string;
  target_agent_id: string | null;
  baseline_model: string;
  baseline_reasoning_effort: string;
  candidate_model: string;
  candidate_reasoning_effort: string;
  status: string;
  result: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  promoted_at: Date | string | null;
}): AiExperiment {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    objective: row.objective,
    targetType: row.target_type as ExperimentTargetType,
    targetAgentId: row.target_agent_id as AgentId | null,
    baselineModel: row.baseline_model,
    baselineReasoningEffort: row.baseline_reasoning_effort,
    candidateModel: row.candidate_model,
    candidateReasoningEffort: row.candidate_reasoning_effort,
    status: row.status as ExperimentStatus,
    result: row.result as ExperimentResultLabel | null,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    promotedAt: row.promoted_at ? new Date(row.promoted_at) : null,
  };
}

const EXPERIMENT_COLUMNS =
  'id, company_id, name, objective, target_type, target_agent_id, baseline_model, baseline_reasoning_effort, ' +
  'candidate_model, candidate_reasoning_effort, status, result, created_at, completed_at, promoted_at';

export async function getExperiment(db: SqlExecutor, companyId: string, experimentId: string): Promise<AiExperiment | null> {
  const res = await db.query(`SELECT ${EXPERIMENT_COLUMNS} FROM ai_experiment WHERE id = $1 AND company_id = $2`, [
    experimentId,
    companyId,
  ]);
  const row = res.rows[0] as Parameters<typeof toExperiment>[0] | undefined;
  return row ? toExperiment(row) : null;
}

export async function listExperiments(db: SqlExecutor, companyId: string): Promise<AiExperiment[]> {
  const res = await db.query(`SELECT ${EXPERIMENT_COLUMNS} FROM ai_experiment WHERE company_id = $1 ORDER BY created_at DESC`, [
    companyId,
  ]);
  return (res.rows as Array<Parameters<typeof toExperiment>[0]>).map(toExperiment);
}

export interface ExperimentMeetingResultInput {
  readonly eligible: boolean;
  readonly ineligibleReason?: string | null;
  readonly baselineScore?: number | null;
  readonly candidateScore?: number | null;
  readonly candidateCostUsd?: number | null;
  readonly candidateLatencyMs?: number | null;
  readonly candidateInputTokens?: number | null;
  readonly candidateOutputTokens?: number | null;
  readonly candidateText?: string | null;
  readonly note?: string | null;
}

export async function saveExperimentMeetingResult(
  db: SqlExecutor,
  experimentId: string,
  meetingId: string,
  input: ExperimentMeetingResultInput,
  encryptionKey: Buffer,
): Promise<void> {
  await db.query(
    `INSERT INTO ai_experiment_meeting_result
       (experiment_id, meeting_id, eligible, ineligible_reason, baseline_score, candidate_score,
        candidate_cost_usd, candidate_latency_ms, candidate_input_tokens, candidate_output_tokens,
        candidate_text_enc, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      experimentId,
      meetingId,
      input.eligible,
      input.ineligibleReason ?? null,
      input.baselineScore ?? null,
      input.candidateScore ?? null,
      input.candidateCostUsd ?? null,
      input.candidateLatencyMs ?? null,
      input.candidateInputTokens ?? null,
      input.candidateOutputTokens ?? null,
      input.candidateText ? encryptField(input.candidateText, encryptionKey) : null,
      input.note ?? null,
    ],
  );
}

export interface ExperimentMeetingResult {
  readonly id: string;
  readonly meetingId: string;
  readonly meetingTitle: string;
  readonly eligible: boolean;
  readonly ineligibleReason: string | null;
  readonly baselineScore: number | null;
  readonly candidateScore: number | null;
  readonly candidateCostUsd: number | null;
  readonly candidateLatencyMs: number | null;
  readonly candidateText: string | null;
  readonly note: string | null;
}

export async function listExperimentMeetingResults(
  db: SqlExecutor,
  experimentId: string,
  encryptionKey: Buffer,
): Promise<ExperimentMeetingResult[]> {
  const res = await db.query<{
    id: string;
    meeting_id: string;
    title_enc: string;
    eligible: boolean;
    ineligible_reason: string | null;
    baseline_score: number | null;
    candidate_score: number | null;
    candidate_cost_usd: number | null;
    candidate_latency_ms: number | null;
    candidate_text_enc: string | null;
    note: string | null;
  }>(
    `SELECT r.id, r.meeting_id, m.title_enc, r.eligible, r.ineligible_reason, r.baseline_score, r.candidate_score,
            r.candidate_cost_usd, r.candidate_latency_ms, r.candidate_text_enc, r.note
     FROM ai_experiment_meeting_result r
     JOIN meeting m ON m.id = r.meeting_id
     WHERE r.experiment_id = $1
     ORDER BY r.created_at ASC`,
    [experimentId],
  );
  return res.rows.map((r) => {
    let title = 'Reunião';
    let candidateText: string | null = null;
    try {
      title = decryptField(r.title_enc, encryptionKey);
    } catch {
      title = 'Reunião (título ilegível)';
    }
    if (r.candidate_text_enc) {
      try {
        candidateText = decryptField(r.candidate_text_enc, encryptionKey);
      } catch {
        candidateText = null;
      }
    }
    return {
      id: r.id,
      meetingId: r.meeting_id,
      meetingTitle: title,
      eligible: r.eligible,
      ineligibleReason: r.ineligible_reason,
      baselineScore: r.baseline_score,
      candidateScore: r.candidate_score,
      candidateCostUsd: r.candidate_cost_usd,
      candidateLatencyMs: r.candidate_latency_ms,
      candidateText,
      note: r.note,
    };
  });
}

// ── Comparação pareada de qualidade (Seção 14/15 — 1 chamada, 2 textos) ────

export const QUALITY_COMPARISON_SYSTEM =
  'Você compara DUAS versões do mesmo relatório de um conselheiro de IA sobre a MESMA reunião — ' +
  'BASELINE (configuração atual em produção) e CANDIDATA (configuração em teste). Avalie qual capta ' +
  'melhor a discussão real, é mais específica e evita invenção de fatos/números que a transcrição não ' +
  'sustenta. Responda APENAS com JSON válido (sem cercas): ' +
  '{"baseline_score":0-100,"candidate_score":0-100,"note":"1-2 frases explicando a diferença, em português do Brasil"}. ' +
  'Pontuações próximas (diferença < 3) indicam qualidade equivalente — não force uma diferença que não existe.';

export interface QualityComparisonResult {
  readonly baselineScore: number;
  readonly candidateScore: number;
  readonly note: string;
}

function clamp100(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Parse defensivo — malformado devolve `null` (o chamador marca a reunião sem score, nunca inventa). */
export function parseQualityComparison(raw: string): QualityComparisonResult | null {
  try {
    const obj = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    return {
      baselineScore: clamp100(obj.baseline_score, 50),
      candidateScore: clamp100(obj.candidate_score, 50),
      note: typeof obj.note === 'string' ? obj.note.trim() : '',
    };
  } catch {
    return null;
  }
}

export async function compareReportQuality(
  llm: ILlmProvider,
  transcriptExcerpt: string,
  baselineText: string,
  candidateText: string,
): Promise<QualityComparisonResult | null> {
  if (typeof llm.completeText !== 'function') return null;
  try {
    const res = await llm.completeText({
      system: QUALITY_COMPARISON_SYSTEM,
      prompt:
        `Trecho da transcrição (referência):\n${transcriptExcerpt}\n\n` +
        `BASELINE:\n${baselineText}\n\nCANDIDATA:\n${candidateText}`,
      maxTokens: 300,
    });
    return parseQualityComparison(res.text);
  } catch {
    return null;
  }
}

// ── Classificação do resultado (Seção 29/30 — regras CENTRALIZADAS) ────────

export const EXPERIMENT_ACCEPTANCE_RULES = {
  /** Delta de qualidade mínimo (candidata - baseline) pra não considerar regressão. */
  minQualityDelta: -3,
  /** Delta de qualidade mínimo pra considerar "recomendado" mesmo sem economia de custo. */
  strongQualityDelta: 2,
  /** Redução de custo mínima (fração, ex.: 0.1 = 10%) pra contar como economia relevante. */
  meaningfulCostSavingPct: 0.1,
} as const;

/**
 * `qualityDelta` = média(candidata) - média(baseline), em pontos (0-100).
 * `costDeltaPct` = (custoCandidata - custoBaseline) / custoBaseline (negativo = mais barato).
 * `null` em qualquer um ⇒ 'inconclusive' (dados insuficientes, nunca força um veredito).
 */
export function classifyExperimentResult(
  qualityDelta: number | null,
  costDeltaPct: number | null,
): ExperimentResultLabel {
  if (qualityDelta === null) return 'inconclusive';
  if (qualityDelta < EXPERIMENT_ACCEPTANCE_RULES.minQualityDelta * 2) return 'harmful';
  if (qualityDelta < EXPERIMENT_ACCEPTANCE_RULES.minQualityDelta) return 'not_recommended';
  // qualidade forte o bastante para recomendar por si só, independente de haver dado de custo
  if (qualityDelta >= EXPERIMENT_ACCEPTANCE_RULES.strongQualityDelta) return 'recommended';
  const meaningfulSaving = costDeltaPct !== null && costDeltaPct <= -EXPERIMENT_ACCEPTANCE_RULES.meaningfulCostSavingPct;
  if (meaningfulSaving) return 'recommended';
  if (qualityDelta >= 0) return 'promising';
  return 'inconclusive';
}
