import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { auditedClinicalWrite } from '@conselho/audit';
import { applyPresidentConfig, getPresidentConfig, DEFAULT_PRESIDENT_CONFIG, type PresidentConfig } from '@conselho/kb';
import { isValidAiModel, isValidReasoningEffort, isValidInterventionLevel } from './ai-config';

/**
 * Persistência da "Configuração do Presidente" (governança) — singleton por
 * empresa em `president_config`. Mesmo padrão de `agent_profile`
 * (apps/web/lib/kb-sources.ts): valida contra o catálogo central antes de
 * gravar, nunca confia em valor cru do cliente, e aplica no registry em
 * memória (`@conselho/kb`) imediatamente após salvar — vale para a PRÓXIMA
 * chamada do board, sem restart.
 */
export interface PresidentConfigFieldsInput {
  readonly monitoringModel?: string | null;
  readonly monitoringReasoningEffort?: string | null;
  readonly synthesisModel?: string | null;
  readonly synthesisReasoningEffort?: string | null;
  readonly finalSynthesisReasoningEffort?: string | null;
  readonly interventionLevel?: string | null;
  readonly canRequestCounselors?: boolean;
  readonly canRegisterDecisions?: boolean;
  readonly canOverrideSpecialist?: boolean;
  readonly autoInterruption?: boolean;
}

function normalize(fields: PresidentConfigFieldsInput): PresidentConfig {
  return {
    monitoringModel: isValidAiModel(fields.monitoringModel)
      ? fields.monitoringModel!
      : DEFAULT_PRESIDENT_CONFIG.monitoringModel,
    monitoringReasoningEffort: isValidReasoningEffort(fields.monitoringReasoningEffort)
      ? fields.monitoringReasoningEffort!
      : DEFAULT_PRESIDENT_CONFIG.monitoringReasoningEffort,
    synthesisModel: isValidAiModel(fields.synthesisModel)
      ? fields.synthesisModel!
      : DEFAULT_PRESIDENT_CONFIG.synthesisModel,
    synthesisReasoningEffort: isValidReasoningEffort(fields.synthesisReasoningEffort)
      ? fields.synthesisReasoningEffort!
      : DEFAULT_PRESIDENT_CONFIG.synthesisReasoningEffort,
    finalSynthesisReasoningEffort: isValidReasoningEffort(fields.finalSynthesisReasoningEffort)
      ? fields.finalSynthesisReasoningEffort!
      : DEFAULT_PRESIDENT_CONFIG.finalSynthesisReasoningEffort,
    interventionLevel: (isValidInterventionLevel(fields.interventionLevel)
      ? fields.interventionLevel
      : DEFAULT_PRESIDENT_CONFIG.interventionLevel) as PresidentConfig['interventionLevel'],
    // única política suportada hoje — sempre grava o valor válido, nunca lê do cliente (Seção 6/19)
    consensusPolicy: DEFAULT_PRESIDENT_CONFIG.consensusPolicy,
    canRequestCounselors: fields.canRequestCounselors ?? DEFAULT_PRESIDENT_CONFIG.canRequestCounselors,
    canRegisterDecisions: fields.canRegisterDecisions ?? DEFAULT_PRESIDENT_CONFIG.canRegisterDecisions,
    canOverrideSpecialist: fields.canOverrideSpecialist ?? DEFAULT_PRESIDENT_CONFIG.canOverrideSpecialist,
    autoInterruption: fields.autoInterruption ?? DEFAULT_PRESIDENT_CONFIG.autoInterruption,
  };
}

export async function savePresidentConfig(
  db: SqlExecutor,
  companyId: string,
  fields: PresidentConfigFieldsInput,
): Promise<void> {
  const c = normalize(fields);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'president-config-edit', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO president_config
           (company_id, monitoring_model, monitoring_reasoning_effort, synthesis_model,
            synthesis_reasoning_effort, final_synthesis_reasoning_effort, intervention_level,
            consensus_policy, can_request_counselors, can_register_decisions,
            can_override_specialist, auto_interruption)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (company_id) DO UPDATE
           SET monitoring_model = EXCLUDED.monitoring_model,
               monitoring_reasoning_effort = EXCLUDED.monitoring_reasoning_effort,
               synthesis_model = EXCLUDED.synthesis_model,
               synthesis_reasoning_effort = EXCLUDED.synthesis_reasoning_effort,
               final_synthesis_reasoning_effort = EXCLUDED.final_synthesis_reasoning_effort,
               intervention_level = EXCLUDED.intervention_level,
               consensus_policy = EXCLUDED.consensus_policy,
               can_request_counselors = EXCLUDED.can_request_counselors,
               can_register_decisions = EXCLUDED.can_register_decisions,
               can_override_specialist = EXCLUDED.can_override_specialist,
               auto_interruption = EXCLUDED.auto_interruption,
               updated_at = now()`,
        [
          companyId,
          c.monitoringModel,
          c.monitoringReasoningEffort,
          c.synthesisModel,
          c.synthesisReasoningEffort,
          c.finalSynthesisReasoningEffort,
          c.interventionLevel,
          c.consensusPolicy,
          c.canRequestCounselors,
          c.canRegisterDecisions,
          c.canOverrideSpecialist,
          c.autoInterruption,
        ],
      );
      return null;
    },
  );
  applyPresidentConfig(companyId, c);
}

/** Carrega e APLICA a config do Presidente da EMPRESA (boot/1º acesso + após edição). */
export async function loadAndApplyPresidentConfig(db: SqlExecutor, companyId: string): Promise<void> {
  const res = await db.query<{
    monitoring_model: string;
    monitoring_reasoning_effort: string;
    synthesis_model: string;
    synthesis_reasoning_effort: string;
    final_synthesis_reasoning_effort: string;
    intervention_level: string;
    consensus_policy: string;
    can_request_counselors: boolean;
    can_register_decisions: boolean;
    can_override_specialist: boolean;
    auto_interruption: boolean;
  }>(
    `SELECT monitoring_model, monitoring_reasoning_effort, synthesis_model, synthesis_reasoning_effort,
            final_synthesis_reasoning_effort, intervention_level, consensus_policy,
            can_request_counselors, can_register_decisions, can_override_specialist, auto_interruption
     FROM president_config WHERE company_id = $1`,
    [companyId],
  );
  const row = res.rows[0];
  if (!row) return; // sem linha ⇒ getPresidentConfig() já cai nos defaults (Seção 21)
  applyPresidentConfig(companyId, {
    monitoringModel: row.monitoring_model,
    monitoringReasoningEffort: row.monitoring_reasoning_effort,
    synthesisModel: row.synthesis_model,
    synthesisReasoningEffort: row.synthesis_reasoning_effort,
    finalSynthesisReasoningEffort: row.final_synthesis_reasoning_effort,
    interventionLevel: row.intervention_level as PresidentConfig['interventionLevel'],
    consensusPolicy: row.consensus_policy,
    canRequestCounselors: row.can_request_counselors,
    canRegisterDecisions: row.can_register_decisions,
    canOverrideSpecialist: row.can_override_specialist,
    autoInterruption: row.auto_interruption,
  });
}

export { getPresidentConfig };
