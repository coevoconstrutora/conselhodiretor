/**
 * Configuration Score do Auto Configurador (Etapa "Auto Configurador",
 * Seções 28/29) — DETERMINÍSTICO (checagem de presença de campo), nunca
 * pedido ao LLM: mesmo princípio já usado no Auto-análise (Seção 34 de lá —
 * nunca precisão falsa). Só a PROPOSTA de mudança (o que preencher/ajustar)
 * vem do LLM; o score em si é 100% verificável e reproduzível.
 */

export interface ConfigurationScoreInput {
  readonly hasProfessionalProfile: boolean;
  readonly hasDecisionCriteria: boolean;
  readonly hasRiskPosture: boolean;
  readonly hasScopeCan: boolean;
  readonly hasScopeCannot: boolean;
  readonly kbSourceCount: number;
  readonly aiModelConfigured: boolean;
}

export interface ConfigurationScore {
  readonly overall: number;
  readonly profile: number;
  readonly expertise: number;
  readonly criteria: number;
  readonly scope: number;
  readonly knowledge: number;
  readonly ai: number;
}

export function computeConfigurationScore(input: ConfigurationScoreInput): ConfigurationScore {
  const profile = input.hasProfessionalProfile ? 100 : 40;
  const expertise = input.hasProfessionalProfile ? 100 : 30; // perfil profissional é onde a expertise é descrita hoje
  const criteria = input.hasDecisionCriteria ? 100 : (input.hasRiskPosture ? 60 : 30);
  const scope = input.hasScopeCan && input.hasScopeCannot ? 100 : input.hasScopeCan ? 70 : 20;
  const knowledge = input.kbSourceCount === 0 ? 40 : Math.min(100, 60 + input.kbSourceCount * 10);
  const ai = input.aiModelConfigured ? 100 : 80; // sem config própria cai no default do produto — nunca "quebrado"
  const overall = Math.round((profile + expertise + criteria + scope + knowledge + ai) / 6);
  return { overall, profile, expertise, criteria, scope, knowledge, ai };
}

export type ScoreLabel = 'bem_configurado' | 'boa_configuracao' | 'revisao_recomendada' | 'incompleta';

/** Seção 29 — faixas de interpretação. */
export function classifyScoreLabel(overall: number): ScoreLabel {
  if (overall >= 90) return 'bem_configurado';
  if (overall >= 75) return 'boa_configuracao';
  if (overall >= 60) return 'revisao_recomendada';
  return 'incompleta';
}

export const SCORE_LABEL_TEXT: Record<ScoreLabel, string> = {
  bem_configurado: 'Bem configurado',
  boa_configuracao: 'Boa configuração',
  revisao_recomendada: 'Revisão recomendada',
  incompleta: 'Configuração incompleta',
};

/** Seção 64/34 — nunca aparentar mais confiança do que os dados sustentam. */
export function buildDataSufficiencyNote(meetingsAnalyzed: number): string {
  if (meetingsAnalyzed === 0) {
    return 'Configuração baseada principalmente em contexto organizacional (sem histórico de reuniões deste conselheiro ainda).';
  }
  if (meetingsAnalyzed < 3) {
    return `Configuração baseada em contexto organizacional + ${meetingsAnalyzed} reunião(ões) — sinal inicial, ainda limitado.`;
  }
  return `Configuração baseada em contexto organizacional + ${meetingsAnalyzed} reuniões históricas.`;
}
