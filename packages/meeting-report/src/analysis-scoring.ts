/**
 * Métricas DETERMINÍSTICAS da análise automática (Etapa "Auto-análise e
 * melhoria contínua") — checagem de presença de campo, não julgamento de
 * IA. Mais barato e 100% preciso que pedir pro LLM "adivinhar" isto; o LLM
 * só entra para as dimensões que exigem julgamento de conteúdo (Seção 34 —
 * nunca apresentar conclusão de ML com precisão falsa).
 */

export interface DecisionCompleteness {
  readonly responsible: string;
  readonly deadline: Date | null;
  readonly evidence: string;
}

export interface ActionItemCompleteness {
  readonly responsible: string;
  readonly deadline: Date | null;
}

/** Seção 11 — decisão "completa" tem responsável + evidência (prazo nem sempre se aplica, pesa menos). */
export function scoreDecisionClarity(decisions: readonly DecisionCompleteness[]): number | null {
  if (decisions.length === 0) return null;
  const points = decisions.reduce((sum, d) => {
    let score = 0;
    if (d.responsible.trim()) score += 0.4;
    if (d.evidence.trim()) score += 0.4;
    if (d.deadline) score += 0.2;
    return sum + score;
  }, 0);
  return Math.round((points / decisions.length) * 100);
}

/** Seção 12 — ação "completa" tem responsável + prazo. */
export function scoreActionItemQuality(actions: readonly ActionItemCompleteness[]): number | null {
  if (actions.length === 0) return null;
  const points = actions.reduce((sum, a) => {
    let score = 0;
    if (a.responsible.trim()) score += 0.5;
    if (a.deadline) score += 0.5;
    return sum + score;
  }, 0);
  return Math.round((points / actions.length) * 100);
}

/** Seção 9 — taxa de candidatos descartados por duplicidade semântica (já medida pelo gate, não estimada). */
export function scoreRedundancyControl(totalCandidates: number, semanticDuplicates: number): number | null {
  if (totalCandidates === 0) return null;
  const duplicateRate = semanticDuplicates / totalCandidates;
  return Math.round(Math.max(0, 1 - duplicateRate) * 100);
}

/**
 * Score geral ponderado (Seção 5) — pesos CENTRALIZADOS aqui (nunca
 * espalhados pela aplicação). Dimensões ausentes (ex.: sem reunião anterior
 * ⇒ meeting_continuity null) são excluídas do cálculo, não tratadas como 0.
 */
export const SCORE_WEIGHTS = {
  counselorRelevance: 0.15,
  routingQuality: 0.15,
  suggestionQuality: 0.15,
  redundancyControl: 0.1,
  presidentQuality: 0.15,
  decisionClarity: 0.1,
  actionItemQuality: 0.1,
  knowledgeGrounding: 0.05,
  meetingContinuity: 0.05,
} as const;

export type ScoreDimensions = { readonly [K in keyof typeof SCORE_WEIGHTS]: number | null };

export function computeOverallScore(scores: ScoreDimensions): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of Object.keys(SCORE_WEIGHTS) as Array<keyof typeof SCORE_WEIGHTS>) {
    const value = scores[key];
    if (value === null) continue;
    weightedSum += value * SCORE_WEIGHTS[key];
    totalWeight += SCORE_WEIGHTS[key];
  }
  if (totalWeight === 0) return null;
  return Math.round(weightedSum / totalWeight);
}
