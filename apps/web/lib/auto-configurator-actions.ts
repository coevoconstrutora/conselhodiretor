'use server';

import { revalidatePath } from 'next/cache';
import { getAgentProfiles } from '@conselho/kb';
import type { AgentId } from '@conselho/providers';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { createLlm } from './llm';
import { loadAndApplyProfileOverrides, saveAgentProfile, loadScopeSplit } from './kb-sources';
import { runAutoConfigurator, type AutoConfiguratorFocus, type ConfiguratorProposal } from './auto-configurator';
import type { ConfigurationScore } from './auto-configurator-scoring';

export type AutoConfiguratorActionState = {
  error?: string;
  ok?: string;
  agentId?: string;
  displayName?: string;
  current?: {
    professionalProfile: string | null;
    decisionCriteria: string | null;
    riskPosture: string | null;
    scopeCan: string;
    scopeCannot: string;
    aiModel: string | null;
    reasoningEffort: string | null;
  };
  proposal?: ConfiguratorProposal;
  score?: ConfigurationScore;
  dataSufficiencyNote?: string;
} | null;

/** "Auto Configurar" (individual, Seção 8) — gera a proposta, NUNCA aplica sozinho. */
export async function runAutoConfiguratorAction(
  _prev: AutoConfiguratorActionState,
  formData: FormData,
): Promise<AutoConfiguratorActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem usar o Auto Configurador.' };
  const agentId = String(formData.get('agentId') ?? '') as AgentId;
  const focus = (String(formData.get('focus') ?? 'completo') || 'completo') as AutoConfiguratorFocus;
  const includeHistory = formData.get('includeHistory') !== 'off';

  const db = await getDb();
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profile = getAgentProfiles(user.companyId)[agentId];
  if (!profile || agentId === 'presidente') return { error: 'Conselheiro inválido.' };

  try {
    const { llm } = createLlm({ maxTokens: 900 });
    const { scopeCan, scopeCannot } = await loadScopeSplit(db, user.companyId, agentId);
    const result = await runAutoConfigurator(db, llm, user.companyId, agentId, focus, includeHistory);
    if (!result.proposal) {
      return { error: 'O modelo não gerou uma proposta válida — tente novamente.' };
    }
    return {
      ok: 'Proposta gerada — revise e aprove só o que fizer sentido.',
      agentId,
      displayName: profile.displayName,
      current: {
        professionalProfile: profile.professionalProfile ?? null,
        decisionCriteria: profile.decisionCriteria ?? null,
        riskPosture: profile.riskPosture ?? null,
        scopeCan,
        scopeCannot,
        aiModel: profile.aiModel ?? null,
        reasoningEffort: profile.reasoningEffort ?? null,
      },
      proposal: result.proposal,
      score: result.score,
      dataSufficiencyNote: result.dataSufficiencyNote,
    };
  } catch (err) {
    console.error('[auto-configurador] gerar proposta falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao gerar a proposta.' };
  }
}

export type ApplyConfiguratorState = { error?: string; ok?: string } | null;

/**
 * "Aplicar selecionados" (Seção 26) — SÓ os campos com o checkbox marcado
 * entram; os demais preservam o valor ATUAL (nunca all-or-nothing). Passa
 * pelo MESMO `saveAgentProfile` já auditado — sem tabela de versão própria
 * nesta entrega (o audit_log já registra quem mudou o quê e quando).
 * Assinatura (prevState, formData) — não void — pra alimentar `useActionState`
 * no painel (spinner enquanto aplica + confirmação ao terminar).
 */
export async function applyAutoConfiguratorAction(
  _prev: ApplyConfiguratorState,
  formData: FormData,
): Promise<ApplyConfiguratorState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem aplicar configurações.' };
  const agentId = String(formData.get('agentId') ?? '') as AgentId;
  if (!agentId) return { error: 'Conselheiro inválido.' };

  try {
    const db = await getDb();
    await loadAndApplyProfileOverrides(db, user.companyId);
    const profile = getAgentProfiles(user.companyId)[agentId];
    if (!profile) return { error: 'Conselheiro não encontrado.' };
    const current = await loadScopeSplit(db, user.companyId, agentId);

    const accept = (field: string) => formData.get(`accept_${field}`) === 'on';
    const professionalProfile = accept('professionalProfile')
      ? String(formData.get('proposedProfessionalProfile') ?? '')
      : (profile.professionalProfile ?? '');
    const decisionCriteria = accept('decisionCriteria')
      ? String(formData.get('proposedDecisionCriteria') ?? '')
      : (profile.decisionCriteria ?? '');
    const riskPosture = accept('riskPosture') ? String(formData.get('proposedRiskPosture') ?? '') : (profile.riskPosture ?? '');
    const scopeCan = accept('scopeCan') ? String(formData.get('proposedScopeCan') ?? '') : current.scopeCan;
    const scopeCannot = accept('scopeCannot') ? String(formData.get('proposedScopeCannot') ?? '') : current.scopeCannot;
    const aiModel = accept('aiModel') ? String(formData.get('proposedAiModel') ?? '') : (profile.aiModel ?? '');
    const reasoningEffort = accept('reasoningEffort')
      ? String(formData.get('proposedReasoningEffort') ?? '')
      : (profile.reasoningEffort ?? '');

    await saveAgentProfile(db, user.companyId, agentId, profile.displayName, scopeCan, scopeCannot, {
      iconKey: profile.iconKey,
      iconColor: profile.iconColor,
      professionalProfile,
      decisionCriteria,
      riskPosture,
      riskPostureNotes: profile.riskPostureNotes,
      aiModel,
      reasoningEffort,
      voice: profile.voice,
      voiceInstructions: profile.voiceInstructions,
      speechRate: profile.speechRate,
    });
    revalidatePath(`/counselors/${agentId}`);
    revalidatePath('/counselors');
    return { ok: 'Configuração aplicada.' };
  } catch (err) {
    console.error('[auto-configurador] aplicar falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao aplicar a configuração.' };
  }
}

export interface BoardConfiguratorSummary {
  readonly agentId: string;
  readonly displayName: string;
  readonly score: ConfigurationScore;
  readonly reasoning: string;
  readonly hasProposal: boolean;
}

export type BoardConfiguratorState = { error?: string; results?: BoardConfiguratorSummary[] } | null;

/** "Auto Configurar Conselho" (board inteiro, Seção 5) — roda 1 por 1, síncrono; revisão/aprovação continua sendo por conselheiro. */
export async function runBoardAutoConfiguratorAction(
  _prev: BoardConfiguratorState,
  formData: FormData,
): Promise<BoardConfiguratorState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem usar o Auto Configurador.' };

  const selected = formData.getAll('agentIds').map(String) as AgentId[];
  if (selected.length === 0) return { error: 'Selecione ao menos um conselheiro.' };
  const depth = String(formData.get('depth') ?? 'padrao');
  const includeHistory = depth !== 'rapida';

  const db = await getDb();
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);
  const { llm } = createLlm({ maxTokens: 900 });

  const results: BoardConfiguratorSummary[] = [];
  for (const agentId of selected) {
    const profile = profiles[agentId];
    if (!profile || agentId === 'presidente') continue;
    try {
      const result = await runAutoConfigurator(db, llm, user.companyId, agentId, 'completo', includeHistory);
      results.push({
        agentId,
        displayName: profile.displayName,
        score: result.score,
        reasoning: result.proposal?.reasoning ?? 'Não foi possível gerar uma proposta para este conselheiro.',
        hasProposal: result.proposal !== null,
      });
    } catch (err) {
      console.error(`[auto-configurador] falhou para ${agentId}:`, err);
      results.push({
        agentId,
        displayName: profile.displayName,
        score: { overall: 0, profile: 0, expertise: 0, criteria: 0, scope: 0, knowledge: 0, ai: 0 },
        reasoning: 'Falha ao analisar este conselheiro.',
        hasProposal: false,
      });
    }
  }
  return { results };
}
