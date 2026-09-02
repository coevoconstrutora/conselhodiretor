import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { stripJsonFences, type ILlmProvider, type AgentId } from '@conselho/providers';
import { getAgentProfiles, getCompanyProfile, type RiskPosture } from '@conselho/kb';
import { listMeetingImprovements } from '@conselho/meeting-report';
import { getEncryptionKey } from './crypto-key';
import { countKbSourcesByAgent, loadScopeSplit } from './kb-sources';
import { isValidAiModel, isValidReasoningEffort } from './ai-config';
import { computeConfigurationScore, buildDataSufficiencyNote, type ConfigurationScore } from './auto-configurator-scoring';

/**
 * Auto Configurador (Etapa "Auto Configurador") — motor ÚNICO reusado pela
 * entrada de conselho inteiro (/counselors) e pela entrada individual
 * (/counselors/:id). NUNCA modifica um conselheiro sozinho: sempre devolve
 * uma PROPOSTA (este módulo é puramente leitura/geração); a aplicação real
 * passa por `saveAgentProfile`, campo a campo, só com o que o dono aprovar.
 *
 * Escopo desta entrega (ver relatório final): responde com base em
 * CONTEXTO ORGANIZACIONAL + DESEMPENHO HISTÓRICO já existentes no produto —
 * pesquisa externa autoritativa (governo/normas/frameworks) exigiria uma
 * integração nova de busca web com chave própria (nenhuma existe neste
 * deploy, análogo a ANTHROPIC_API_KEY/DEEPGRAM_API_KEY) e fica de fora.
 */

export type AutoConfiguratorFocus =
  | 'completo'
  | 'perfil'
  | 'criterios'
  | 'escopo'
  | 'conhecimento'
  | 'ia'
  | 'atualizar_tudo';

export interface ConfiguratorProposal {
  readonly professionalProfile: string | null;
  readonly expertise: readonly string[];
  readonly decisionCriteria: string | null;
  readonly riskPosture: RiskPosture | null;
  readonly scopeCan: string | null;
  readonly scopeCannot: string | null;
  readonly triggerKeywords: readonly string[];
  readonly aiModelRecommendation: { readonly model: string; readonly reasoningEffort: string; readonly reason: string } | null;
  readonly knowledgeGaps: readonly string[];
  readonly reasoning: string;
}

const RISK_POSTURES = new Set<RiskPosture>(['conservative', 'moderate', 'aggressive']);

const FOCUS_INSTRUCTION: Record<AutoConfiguratorFocus, string> = {
  completo: 'Proponha TODOS os campos abaixo.',
  perfil: 'Foque em professional_profile e expertise — deixe os demais campos como null/[] se não tiver mudança relevante.',
  criterios: 'Foque em decision_criteria e risk_posture — deixe os demais como null/[] se não tiver mudança relevante.',
  escopo: 'Foque em scope_can, scope_cannot e trigger_keywords — deixe os demais como null/[] se não tiver mudança relevante.',
  conhecimento: 'Foque em knowledge_gaps — deixe os demais campos como null/[].',
  ia: 'Foque em ai_model_recommendation — deixe os demais campos como null/[].',
  atualizar_tudo: 'Proponha TODOS os campos abaixo, revisando cada um com cuidado.',
};

function buildSystemPrompt(focus: AutoConfiguratorFocus): string {
  return (
    'Você é o Auto Configurador do Conselho — um assistente que PROPÕE (nunca aplica sozinho) ' +
    'configuração para um conselheiro de IA de uma incorporadora imobiliária. Combine o papel/título ' +
    'do conselheiro com o CONTEXTO REAL da organização (setor, porte, região) e o histórico fornecido ' +
    '— não descreva genericamente "o que um CFO normalmente faz", descreva o que ESTE conselheiro, ' +
    'NESTA organização, deveria saber/avaliar/monitorar. O perfil profissional NUNCA deve alegar ' +
    'credenciais reais (ex.: "advogado licenciado com 20 anos") — descreva a PERSPECTIVA que ele deve ' +
    'aplicar (ex.: "atua com a perspectiva esperada de um profissional experiente de Compliance"). ' +
    `${FOCUS_INSTRUCTION[focus]} ` +
    'Responda APENAS com JSON válido (sem cercas de código): ' +
    '{"professional_profile":"... ou null","expertise":["..."],"decision_criteria":"... ou null",' +
    '"risk_posture":"conservative|moderate|aggressive ou null","scope_can":"... ou null",' +
    '"scope_cannot":"... ou null","trigger_keywords":["..."],' +
    '"ai_model_recommendation":{"model":"gpt-5.6-luna|gpt-5.6-terra|gpt-5.6-sol",' +
    '"reasoning_effort":"none|low|medium|high|xhigh|max","reason":"..."} ou null,' +
    '"knowledge_gaps":["..."],"reasoning":"1-2 frases explicando as principais mudanças propostas"}. ' +
    'Todo texto em português do Brasil. Se não houver evidência para propor um campo, use null/[] — ' +
    'nunca invente para parecer completo.'
  );
}

function parseStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, max);
}

/** Parse DEFENSIVO — malformado devolve `null` (o chamador mostra "geração falhou", nunca aplica nada). */
export function parseConfiguratorProposal(raw: string): ConfiguratorProposal | null {
  try {
    const obj = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    const rec = obj.ai_model_recommendation as Record<string, unknown> | null | undefined;
    const aiModelRecommendation =
      rec && isValidAiModel(rec.model) && isValidReasoningEffort(rec.reasoning_effort)
        ? { model: rec.model as string, reasoningEffort: rec.reasoning_effort as string, reason: typeof rec.reason === 'string' ? rec.reason.trim() : '' }
        : null;
    return {
      professionalProfile: typeof obj.professional_profile === 'string' && obj.professional_profile.trim() ? obj.professional_profile.trim() : null,
      expertise: parseStringArray(obj.expertise, 10),
      decisionCriteria: typeof obj.decision_criteria === 'string' && obj.decision_criteria.trim() ? obj.decision_criteria.trim() : null,
      riskPosture: RISK_POSTURES.has(obj.risk_posture as RiskPosture) ? (obj.risk_posture as RiskPosture) : null,
      scopeCan: typeof obj.scope_can === 'string' && obj.scope_can.trim() ? obj.scope_can.trim() : null,
      scopeCannot: typeof obj.scope_cannot === 'string' && obj.scope_cannot.trim() ? obj.scope_cannot.trim() : null,
      triggerKeywords: parseStringArray(obj.trigger_keywords, 20),
      aiModelRecommendation,
      knowledgeGaps: parseStringArray(obj.knowledge_gaps, 8),
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.trim() : '',
    };
  } catch {
    return null;
  }
}

export interface AutoConfiguratorResult {
  readonly proposal: ConfiguratorProposal | null;
  readonly score: ConfigurationScore;
  readonly dataSufficiencyNote: string;
  readonly evidence: {
    readonly meetingsAnalyzed: number;
    readonly kbSourceCount: number;
    readonly relatedProblems: readonly string[];
  };
}

/**
 * Reúne o contexto real + gera a proposta. Nunca lança: falha do LLM
 * devolve `proposal: null`. `includeHistory` = false (profundidade
 * "Rápida", Seção 7) pula a leitura de desempenho histórico — mais rápido/
 * barato, usa só contexto organizacional + conhecimento já cadastrado.
 */
export async function runAutoConfigurator(
  db: SqlExecutor,
  llm: ILlmProvider,
  companyId: string,
  agentId: AgentId,
  focus: AutoConfiguratorFocus,
  includeHistory: boolean = true,
  modelOverride?: string,
  reasoningEffortOverride?: string,
): Promise<AutoConfiguratorResult> {
  const profile = getAgentProfiles(companyId)[agentId];
  if (!profile) throw new Error(`Conselheiro desconhecido: ${agentId}.`);
  const companyProfile = getCompanyProfile(companyId);
  const kbCounts = await countKbSourcesByAgent(db, companyId);
  const kbSourceCount = kbCounts.get(agentId) ?? 0;
  const { scopeCan, scopeCannot } = await loadScopeSplit(db, companyId, agentId);

  // Evidência REAL de desempenho histórico (Etapa "Auto-análise", já entregue) — nunca inventada.
  const improvements = includeHistory ? await listMeetingImprovements(db, companyId, getEncryptionKey(), 30) : [];
  const relatedProblems: string[] = [];
  let meetingsWithThisAgent = 0;
  for (const item of improvements) {
    const counselorEntry = item.analysis?.counselorAnalysis.find((c) => c.agentId === agentId);
    if (counselorEntry) {
      meetingsWithThisAgent += 1;
      if (counselorEntry.note) relatedProblems.push(counselorEntry.note);
    }
  }

  const score = computeConfigurationScore({
    hasProfessionalProfile: Boolean(profile.professionalProfile?.trim()),
    hasDecisionCriteria: Boolean(profile.decisionCriteria?.trim()),
    hasRiskPosture: Boolean(profile.riskPosture),
    hasScopeCan: scopeCan.trim().length > 20,
    hasScopeCannot: scopeCannot.trim().length > 0,
    kbSourceCount,
    aiModelConfigured: Boolean(profile.aiModel),
  });

  let proposal: ConfiguratorProposal | null = null;
  if (typeof llm.completeText === 'function') {
    try {
      const companyContext = [
        companyProfile.name ? `Empresa: ${companyProfile.name}` : null,
        companyProfile.segment ? `Setor: ${companyProfile.segment}` : null,
        companyProfile.size ? `Porte: ${companyProfile.size}` : null,
        companyProfile.region?.length ? `Região: ${companyProfile.region.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      const res = await llm.completeText({
        system: buildSystemPrompt(focus),
        prompt:
          `Conselheiro: ${profile.displayName}\n\n` +
          `Contexto da organização:\n${companyContext || '(sem contexto cadastrado)'}\n\n` +
          `Perfil ATUAL:\nEscopo: ${profile.scope}\nPerfil profissional: ${profile.professionalProfile ?? '(vazio)'}\n` +
          `Critérios de decisão: ${profile.decisionCriteria ?? '(vazio)'}\nPostura de risco: ${profile.riskPosture ?? '(vazia)'}\n\n` +
          `Fontes de conhecimento próprias cadastradas: ${kbSourceCount}\n\n` +
          (relatedProblems.length > 0
            ? `Observações de desempenho em reuniões anteriores (${meetingsWithThisAgent} reunião(ões)):\n${relatedProblems.map((p) => `- ${p}`).join('\n')}`
            : 'Sem observações de desempenho histórico ainda (conselheiro novo ou pouco acionado).'),
        maxTokens: 900,
        model: modelOverride,
        reasoningEffort: reasoningEffortOverride,
      });
      proposal = parseConfiguratorProposal(res.text);
    } catch {
      proposal = null;
    }
  }

  return {
    proposal,
    score,
    dataSufficiencyNote: buildDataSufficiencyNote(meetingsWithThisAgent),
    evidence: { meetingsAnalyzed: meetingsWithThisAgent, kbSourceCount, relatedProblems },
  };
}
