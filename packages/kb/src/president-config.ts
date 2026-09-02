/**
 * Configuração do Presidente (governança) — SINGLETON por empresa, distinta
 * do `agent_profile` de um conselheiro comum: o Presidente não tem UM
 * modelo/raciocínio, tem DOIS (acompanhamento vs. síntese), mais um terceiro
 * nível de raciocínio só para a síntese final de encerramento, e uma camada
 * de governança (nível de intervenção, política de consenso, autoridade)
 * sem equivalente nos conselheiros especialistas. Mesmo padrão de mutação em
 * memória do `company-profile.ts`/`reasoner.ts`: o objeto daquela empresa
 * vale imediatamente para o board/síntese/relatórios, sem restart.
 */
export interface PresidentConfig {
  readonly monitoringModel: string;
  readonly monitoringReasoningEffort: string;
  readonly synthesisModel: string;
  readonly synthesisReasoningEffort: string;
  readonly finalSynthesisReasoningEffort: string;
  readonly interventionLevel: 'low' | 'moderate' | 'active';
  readonly consensusPolicy: string;
  readonly canRequestCounselors: boolean;
  readonly canRegisterDecisions: boolean;
  readonly canOverrideSpecialist: boolean;
  readonly autoInterruption: boolean;
}

/** Defaults do pedido (Seção 21 — compatibilidade: nenhuma linha salva ainda cai aqui). */
export const DEFAULT_PRESIDENT_CONFIG: PresidentConfig = {
  monitoringModel: 'gpt-5.6-terra',
  monitoringReasoningEffort: 'medium',
  synthesisModel: 'gpt-5.6-sol',
  synthesisReasoningEffort: 'high',
  finalSynthesisReasoningEffort: 'xhigh',
  interventionLevel: 'moderate',
  consensusPolicy: 'preserve_disagreement',
  canRequestCounselors: true,
  canRegisterDecisions: true,
  canOverrideSpecialist: false,
  autoInterruption: false,
};

const configByCompany = new Map<string, PresidentConfig>();

export function applyPresidentConfig(companyId: string, config: Partial<PresidentConfig>): void {
  configByCompany.set(companyId, {
    ...DEFAULT_PRESIDENT_CONFIG,
    ...configByCompany.get(companyId),
    ...config,
  });
}

export function getPresidentConfig(companyId: string): PresidentConfig {
  return configByCompany.get(companyId) ?? DEFAULT_PRESIDENT_CONFIG;
}
