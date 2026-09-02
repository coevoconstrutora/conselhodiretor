import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { stripJsonFences, type ILlmProvider, type AgentContribution, type AgentId } from '@conselho/providers';
import type { MeetingDecisionRecord, MeetingActionItemRecord } from './decisions';
import {
  scoreDecisionClarity,
  scoreActionItemQuality,
  scoreRedundancyControl,
  computeOverallScore,
  type ScoreDimensions,
} from './analysis-scoring';

/**
 * Aprendizado do PRODUTO (Etapa "Auto-análise e melhoria contínua") — evolui
 * a análise de texto livre de antes para uma AVALIAÇÃO ESTRUTURADA: nunca
 * avalia o negócio da empresa, só o CONSELHO como sistema (gatilhos,
 * roteamento, redundância, qualidade da síntese do Presidente, clareza de
 * decisões/ações, continuidade com a reunião anterior). Dimensões que dá
 * pra medir sem IA (Seções 9/11/12) são calculadas em código
 * (`analysis-scoring.ts`) — só o que exige julgamento de conteúdo vai pro
 * LLM, com 1 chamada única e barata (default gpt-5.6-luna/medium).
 */

export interface CounselorAnalysisEntry {
  readonly agentId: AgentId;
  readonly timesInvoked: number;
  readonly note: string;
}

export interface MeetingAnalysisScores {
  readonly counselorRelevance: number | null;
  readonly routingQuality: number | null;
  readonly suggestionQuality: number | null;
  readonly redundancyControl: number | null;
  readonly presidentQuality: number | null;
  readonly decisionClarity: number | null;
  readonly actionItemQuality: number | null;
  readonly knowledgeGrounding: number | null;
  readonly meetingContinuity: number | null;
}

export interface MeetingAnalysis {
  readonly overallScore: number | null;
  readonly scores: MeetingAnalysisScores;
  readonly strengths: readonly string[];
  readonly problems: readonly string[];
  readonly recommendations: readonly string[];
  readonly counselorAnalysis: readonly CounselorAnalysisEntry[];
  readonly presidentNote: string;
  readonly continuityNote: string | null;
  readonly costAnalysis: {
    readonly estimatedCostUsd: number | null;
    readonly latencyP50Ms: number | null;
    readonly contributionsCount: number;
  };
  /** "Resumo da análise" (Seção 29) — gerado A PARTIR do estruturado, não o contrário. */
  readonly narrative: string;
}

export interface MeetingAnalysisInput {
  readonly transcriptFinals: readonly string[];
  readonly contributions: readonly AgentContribution[];
  readonly contributionsByAgent: ReadonlyMap<AgentId, number>;
  readonly decisions: readonly MeetingDecisionRecord[];
  readonly actionItems: readonly MeetingActionItemRecord[];
  /** Já formatado (ex.: `buildPreviousMeetingContextBlock`) — `null` se nenhuma reunião anterior foi escolhida. */
  readonly previousMeetingSummary: string | null;
  readonly totalGateCandidates: number;
  readonly semanticDuplicates: number;
  readonly costUsd: number | null;
  readonly latencyP50Ms: number | null;
}

const ANALYSIS_SYSTEM =
  'Você é um analista de produto avaliando o CONSELHO — um sistema de IA com vários agentes ' +
  'consultores que participam ao vivo de reuniões de diretoria de uma incorporadora. NÃO avalie o ' +
  'negócio da empresa nem dê conselhos de negócio: avalie o PRÓPRIO SISTEMA nesta reunião ' +
  'específica — relevância dos conselheiros acionados, qualidade das sugestões, qualidade da síntese ' +
  'do Presidente, se o conhecimento usado sustentou as afirmações importantes, e (quando houver ' +
  'contexto de reunião anterior) se decisões pendentes/ações em aberto foram retomadas. ' +
  'Responda APENAS com JSON válido (sem cercas de código), no formato: ' +
  '{"scores":{"counselor_relevance":0-100,"routing_quality":0-100,"suggestion_quality":0-100,' +
  '"president_quality":0-100,"knowledge_grounding":0-100,"meeting_continuity":0-100 ou null se não ' +
  'houver contexto de reunião anterior},"strengths":["..."],"problems":["..."],' +
  '"recommendations":["..."],"counselor_notes":[{"agentId":"...","note":"..."}],' +
  '"president_note":"...","continuity_note":"... ou null","narrative":"resumo em 2-4 frases"}. ' +
  'strengths/problems/recommendations: no máximo 6 itens cada, objetivos, em português do Brasil. ' +
  'NUNCA avalie/sugira mudança de negócio ou estratégia da empresa — só o comportamento do sistema. ' +
  'Se não houver evidência suficiente para uma dimensão, use null em vez de adivinhar um número.';

const VALID_AGENT_IDS = new Set<AgentId>([
  'engenharia',
  'vendas',
  'mercado',
  'arquitetura',
  'legal',
  'cs',
  'cfo',
  'futurista',
]);

function clampScore(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, max);
}

/** Parse DEFENSIVO do output do LLM — nunca derruba a geração; malformado vira `null` no bloco julgado. */
function parseLlmJudgedFields(raw: string): {
  scores: Pick<
    MeetingAnalysisScores,
    'counselorRelevance' | 'routingQuality' | 'suggestionQuality' | 'presidentQuality' | 'knowledgeGrounding' | 'meetingContinuity'
  >;
  strengths: string[];
  problems: string[];
  recommendations: string[];
  counselorNotes: CounselorAnalysisEntry[];
  presidentNote: string;
  continuityNote: string | null;
  narrative: string;
} | null {
  try {
    const obj = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    const s = (obj.scores ?? {}) as Record<string, unknown>;
    const counselorNotes = Array.isArray(obj.counselor_notes)
      ? (obj.counselor_notes as Record<string, unknown>[]).flatMap((c): CounselorAnalysisEntry[] => {
          const agentId = c.agentId as AgentId;
          const note = typeof c.note === 'string' ? c.note.trim() : '';
          if (!VALID_AGENT_IDS.has(agentId) || !note) return [];
          return [{ agentId, timesInvoked: 0, note }]; // timesInvoked é preenchido pelo chamador (dado real, não do LLM)
        })
      : [];
    return {
      scores: {
        counselorRelevance: clampScore(s.counselor_relevance),
        routingQuality: clampScore(s.routing_quality),
        suggestionQuality: clampScore(s.suggestion_quality),
        presidentQuality: clampScore(s.president_quality),
        knowledgeGrounding: clampScore(s.knowledge_grounding),
        meetingContinuity: clampScore(s.meeting_continuity),
      },
      strengths: parseStringArray(obj.strengths, 6),
      problems: parseStringArray(obj.problems, 6),
      recommendations: parseStringArray(obj.recommendations, 6),
      counselorNotes,
      presidentNote: typeof obj.president_note === 'string' ? obj.president_note.trim() : '',
      continuityNote: typeof obj.continuity_note === 'string' && obj.continuity_note.trim() ? obj.continuity_note.trim() : null,
      narrative: typeof obj.narrative === 'string' ? obj.narrative.trim() : '',
    };
  } catch {
    return null;
  }
}

/**
 * Gera a análise estruturada da reunião. `null` só se não houver NADA para
 * analisar (sem transcrição nem contribuições) — falha do LLM degrada para
 * uma análise com só as dimensões determinísticas (nunca perde o que já é
 * calculável em código).
 */
export async function generateMeetingAnalysis(
  llm: ILlmProvider,
  input: MeetingAnalysisInput,
  modelOverride?: string,
  reasoningEffortOverride?: string,
): Promise<MeetingAnalysis | null> {
  if (input.transcriptFinals.length === 0 && input.contributions.length === 0) return null;

  const decisionClarity = scoreDecisionClarity(input.decisions);
  const actionItemQuality = scoreActionItemQuality(input.actionItems);
  const redundancyControl = scoreRedundancyControl(input.totalGateCandidates, input.semanticDuplicates);

  let judged: ReturnType<typeof parseLlmJudgedFields> = null;
  if (typeof llm.completeText === 'function') {
    try {
      const transcript = input.transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
      const contributionsBlock = input.contributions.map((c) => `[${c.agentId}] (${c.type}) ${c.text}`).join('\n');
      const decisionsBlock = input.decisions.map((d) => `- ${d.topic}: ${d.decision} (${d.status})`).join('\n');
      const actionsBlock = input.actionItems.map((a) => `- ${a.action} (${a.responsible || 'sem responsável'})`).join('\n');
      const res = await llm.completeText({
        system: ANALYSIS_SYSTEM,
        prompt:
          `Transcrição da reunião:\n${transcript}\n\n` +
          `Contribuições dos conselheiros:\n${contributionsBlock}\n\n` +
          `Decisões registradas:\n${decisionsBlock || '(nenhuma)'}\n\n` +
          `Ações registradas:\n${actionsBlock || '(nenhuma)'}\n\n` +
          (input.previousMeetingSummary
            ? `CONTEXTO DA REUNIÃO ANTERIOR (avalie continuidade, não confunda com esta reunião):\n${input.previousMeetingSummary}`
            : 'Nenhuma reunião anterior foi usada como contexto nesta reunião.'),
        maxTokens: 1200,
        model: modelOverride,
        reasoningEffort: reasoningEffortOverride,
      });
      judged = parseLlmJudgedFields(res.text);
    } catch {
      judged = null; // segue só com as dimensões determinísticas
    }
  }

  const scores: MeetingAnalysisScores = {
    counselorRelevance: judged?.scores.counselorRelevance ?? null,
    routingQuality: judged?.scores.routingQuality ?? null,
    suggestionQuality: judged?.scores.suggestionQuality ?? null,
    redundancyControl,
    presidentQuality: judged?.scores.presidentQuality ?? null,
    decisionClarity,
    actionItemQuality,
    knowledgeGrounding: judged?.scores.knowledgeGrounding ?? null,
    meetingContinuity: input.previousMeetingSummary ? (judged?.scores.meetingContinuity ?? null) : null,
  };
  const overallScore = computeOverallScore(scores as ScoreDimensions);

  const counselorAnalysis: CounselorAnalysisEntry[] = [...input.contributionsByAgent.entries()].map(
    ([agentId, timesInvoked]) => {
      const note = judged?.counselorNotes.find((c) => c.agentId === agentId)?.note ?? '';
      return { agentId, timesInvoked, note };
    },
  );

  const narrative =
    judged?.narrative ||
    (overallScore !== null
      ? `Score geral: ${overallScore}/100. ${judged?.problems.length ? judged.problems[0] : 'Sem problemas relevantes identificados.'}`
      : 'Análise gerada só com dados determinísticos — o modelo de julgamento não respondeu.');

  return {
    overallScore,
    scores,
    strengths: judged?.strengths ?? [],
    problems: judged?.problems ?? [],
    recommendations: judged?.recommendations ?? [],
    counselorAnalysis,
    presidentNote: judged?.presidentNote ?? '',
    continuityNote: judged?.continuityNote ?? null,
    costAnalysis: {
      estimatedCostUsd: input.costUsd,
      latencyP50Ms: input.latencyP50Ms,
      contributionsCount: input.contributions.length,
    },
    narrative,
  };
}

export interface MeetingImprovement {
  readonly id: string;
  readonly meetingId: string;
  readonly meetingTitle: string;
  /** "Resumo da análise" — sempre presente, mesmo em análises antigas (pré-estruturação). */
  readonly narrative: string;
  readonly analysis: MeetingAnalysis | null;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
}

/** Persiste a análise — cifrada + auditada atomicamente. Nunca sobrescreve: reanalisar insere nova linha (Seção 31 — histórico de versões). */
export async function saveMeetingAnalysis(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  analysis: MeetingAnalysis,
  encryptionKey: Buffer,
  modelVersion?: string,
): Promise<void> {
  const narrativeEnc = encryptField(analysis.narrative, encryptionKey);
  const structuredEnc = encryptField(JSON.stringify(analysis), encryptionKey);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'meeting-improvement-analysis', kbSources: [], modelVersion: modelVersion ?? 'unknown' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO meeting_improvement (meeting_id, company_id, content_enc, structured_enc, overall_score, model_version)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [meetingId, companyId, narrativeEnc, structuredEnc, analysis.overallScore, modelVersion ?? null],
      );
      return res.rows[0]!.id;
    },
  );
}

function toImprovement(row: {
  id: string;
  meeting_id: string;
  title_enc: string;
  content_enc: string;
  structured_enc: string | null;
  model_version: string | null;
  created_at: Date | string;
}, encryptionKey: Buffer): MeetingImprovement | null {
  try {
    const narrative = decryptField(row.content_enc, encryptionKey);
    const analysis = row.structured_enc ? (JSON.parse(decryptField(row.structured_enc, encryptionKey)) as MeetingAnalysis) : null;
    return {
      id: row.id,
      meetingId: row.meeting_id,
      meetingTitle: decryptField(row.title_enc, encryptionKey),
      narrative,
      analysis,
      modelVersion: row.model_version,
      createdAt: new Date(row.created_at),
    };
  } catch {
    return null; // linha corrompida/chave rotacionada — pula, não derruba a tela
  }
}

/** Análises mais recentes da empresa (todas as reuniões, 1 por reunião — a mais recente de cada), pra tela /improvements. */
export async function listMeetingImprovements(
  db: SqlExecutor,
  companyId: string,
  encryptionKey: Buffer,
  limit = 50,
): Promise<MeetingImprovement[]> {
  const res = await db.query<{
    id: string;
    meeting_id: string;
    title_enc: string;
    content_enc: string;
    structured_enc: string | null;
    model_version: string | null;
    created_at: Date | string;
  }>(
    `SELECT DISTINCT ON (mi.meeting_id) mi.id, mi.meeting_id, m.title_enc, mi.content_enc, mi.structured_enc, mi.model_version, mi.created_at
     FROM meeting_improvement mi
     JOIN meeting m ON m.id = mi.meeting_id
     WHERE mi.company_id = $1
     ORDER BY mi.meeting_id, mi.created_at DESC`,
    [companyId],
  );
  return res.rows
    .flatMap((row) => {
      const parsed = toImprovement(row, encryptionKey);
      return parsed ? [parsed] : [];
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/** Análise mais recente DE UMA reunião (Seção 30 — página histórica da reunião). */
export async function loadLatestMeetingAnalysis(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<MeetingImprovement | null> {
  const res = await db.query<{
    id: string;
    meeting_id: string;
    title_enc: string;
    content_enc: string;
    structured_enc: string | null;
    model_version: string | null;
    created_at: Date | string;
  }>(
    `SELECT mi.id, mi.meeting_id, m.title_enc, mi.content_enc, mi.structured_enc, mi.model_version, mi.created_at
     FROM meeting_improvement mi
     JOIN meeting m ON m.id = mi.meeting_id
     WHERE mi.meeting_id = $1
     ORDER BY mi.created_at DESC LIMIT 1`,
    [meetingId],
  );
  const row = res.rows[0];
  return row ? toImprovement(row, encryptionKey) : null;
}

/** Todas as versões de análise de uma reunião (Seção 31 — "Reanalisar" nunca apaga a anterior). */
export async function listMeetingAnalysisVersions(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<MeetingImprovement[]> {
  const res = await db.query<{
    id: string;
    meeting_id: string;
    title_enc: string;
    content_enc: string;
    structured_enc: string | null;
    model_version: string | null;
    created_at: Date | string;
  }>(
    `SELECT mi.id, mi.meeting_id, m.title_enc, mi.content_enc, mi.structured_enc, mi.model_version, mi.created_at
     FROM meeting_improvement mi
     JOIN meeting m ON m.id = mi.meeting_id
     WHERE mi.meeting_id = $1
     ORDER BY mi.created_at DESC`,
    [meetingId],
  );
  return res.rows.flatMap((row) => {
    const parsed = toImprovement(row, encryptionKey);
    return parsed ? [parsed] : [];
  });
}
