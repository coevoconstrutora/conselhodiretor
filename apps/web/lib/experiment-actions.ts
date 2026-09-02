'use server';

import { revalidatePath } from 'next/cache';
import {
  generateCounselorReport,
  generatePresidentSynthesis,
  loadAgentReport,
  listAgentReports,
  listTranscriptFinals,
  loadTranscriptReview,
  listMeetingContributions,
  createExperiment,
  setExperimentStatus,
  completeExperiment,
  promoteExperiment,
  getExperiment,
  saveExperimentMeetingResult,
  compareReportQuality,
  classifyExperimentResult,
  type ExperimentTargetType,
} from '@conselho/meeting-report';
import { PRICING } from '@conselho/telemetry';
import { decryptField } from '@conselho/crypto';
import { getAgentProfiles } from '@conselho/kb';
import type { AgentId } from '@conselho/providers';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { createLlm } from './llm';
import { loadAndApplyProfileOverrides, saveAgentProfile, loadScopeSplit } from './kb-sources';
import { loadAndApplyPresidentConfig, getPresidentConfig, savePresidentConfig } from './president-config-store';
import { isValidAiModel, isValidReasoningEffort, DEFAULT_AI_MODEL, DEFAULT_REASONING_EFFORT } from './ai-config';

/**
 * Motor de experimentação (Etapa "Experimentação de IA") — REPLAY síncrono
 * de até `MAX_MEETINGS` reuniões históricas, comparando o relatório JÁ
 * SALVO (baseline, nunca re-gerado — Seção 53) contra uma versão CANDIDATA
 * gerada agora com outro modelo/raciocínio. Sem fila de jobs: roda dentro da
 * própria server action, por isso o teto pequeno de reuniões.
 */
const MAX_MEETINGS = 8;

export type ExperimentActionState = { error?: string; ok?: string; experimentId?: string } | null;

/** Reuniões ENCERRADAS da empresa que já têm relatório do alvo — só essas entram no experimento. */
async function listEligibleMeetings(
  companyId: string,
  targetAgentId: string,
  limit: number,
): Promise<Array<{ id: string; title: string }>> {
  const db = await getDb();
  const res = await db.query<{ id: string; title_enc: string }>(
    `SELECT m.id, m.title_enc
     FROM meeting m
     JOIN agent_report r ON r.meeting_id = m.id AND r.agent_id = $2
     WHERE m.company_id = $1 AND m.status = 'closed'
     ORDER BY m.closed_at DESC
     LIMIT $3`,
    [companyId, targetAgentId, limit],
  );
  const key = getEncryptionKey();
  return res.rows.map((r) => {
    let title = 'Reunião';
    try {
      title = decryptField(r.title_enc, key);
    } catch {
      title = 'Reunião (título ilegível)';
    }
    return { id: r.id, title };
  });
}

export async function createExperimentAction(
  _prev: ExperimentActionState,
  formData: FormData,
): Promise<ExperimentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem criar experimentos.' };

  const name = String(formData.get('name') ?? '').trim();
  const objective = String(formData.get('objective') ?? '').trim() || null;
  const targetType = String(formData.get('targetType') ?? '') as ExperimentTargetType;
  const targetAgentIdRaw = String(formData.get('targetAgentId') ?? '').trim();
  const candidateModel = String(formData.get('candidateModel') ?? '').trim();
  const candidateReasoningEffort = String(formData.get('candidateReasoningEffort') ?? '').trim();

  if (name.length < 3) return { error: 'Dê um nome ao experimento (mín. 3 caracteres).' };
  if (targetType !== 'counselor' && targetType !== 'president_synthesis') return { error: 'Alvo inválido.' };
  if (!isValidAiModel(candidateModel)) return { error: 'Modelo candidato inválido.' };
  if (!isValidReasoningEffort(candidateReasoningEffort)) return { error: 'Raciocínio candidato inválido.' };

  const db = await getDb();
  let targetAgentId: AgentId | null = null;
  let baselineModel: string;
  let baselineReasoningEffort: string;
  let reportAgentId: string;

  if (targetType === 'counselor') {
    await loadAndApplyProfileOverrides(db, user.companyId);
    const profile = getAgentProfiles(user.companyId)[targetAgentIdRaw];
    if (!profile || targetAgentIdRaw === 'presidente') return { error: 'Conselheiro inválido.' };
    targetAgentId = targetAgentIdRaw as AgentId;
    baselineModel = profile.aiModel ?? DEFAULT_AI_MODEL;
    baselineReasoningEffort = profile.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    reportAgentId = targetAgentIdRaw;
  } else {
    await loadAndApplyPresidentConfig(db, user.companyId);
    const config = getPresidentConfig(user.companyId);
    baselineModel = config.synthesisModel;
    baselineReasoningEffort = config.synthesisReasoningEffort;
    reportAgentId = 'presidente';
  }

  const eligible = await listEligibleMeetings(user.companyId, reportAgentId, MAX_MEETINGS);
  if (eligible.length === 0) {
    return { error: 'Nenhuma reunião encerrada com relatório deste alvo ainda — gere relatórios antes de experimentar.' };
  }

  try {
    const experimentId = await createExperiment(db, user.companyId, user.id, {
      name,
      objective,
      targetType,
      targetAgentId,
      baselineModel,
      baselineReasoningEffort,
      candidateModel,
      candidateReasoningEffort,
    });
    revalidatePath('/improvements');
    return { ok: `Experimento criado com ${eligible.length} reunião(ões) elegível(is).`, experimentId };
  } catch (err) {
    console.error('[experimentos] criar falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao criar o experimento.' };
  }
}

/**
 * Roda o experimento (síncrono, até MAX_MEETINGS reuniões): por reunião,
 * carrega o relatório oficial (baseline, nunca re-gerado), gera a versão
 * CANDIDATA com o modelo/raciocínio em teste, e pede a 1 chamada de LLM que
 * compare as duas (pareado). Nunca escreve em agent_report/meeting — tudo
 * fica em ai_experiment_meeting_result.
 */
export async function runExperimentAction(
  _prev: ExperimentActionState,
  formData: FormData,
): Promise<ExperimentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem rodar experimentos.' };
  const experimentId = String(formData.get('experimentId') ?? '');
  if (!experimentId) return { error: 'Experimento inválido.' };

  const db = await getDb();
  const key = getEncryptionKey();
  const experiment = await getExperiment(db, user.companyId, experimentId);
  if (!experiment) return { error: 'Experimento não encontrado.' };

  const reportAgentId = experiment.targetType === 'counselor' ? experiment.targetAgentId! : 'presidente';
  const eligible = await listEligibleMeetings(user.companyId, reportAgentId, MAX_MEETINGS);

  try {
    await setExperimentStatus(db, experimentId, 'running');
    let lastUsage = { inputTokens: 0, outputTokens: 0 };
    const { llm } = createLlm({
      maxTokens: 4000,
      longForm: true,
      onUsage: (u) => {
        lastUsage = u;
      },
    });

    const qualityDeltas: number[] = [];
    const costDeltas: number[] = [];

    for (const meeting of eligible) {
      const baselineReport = await loadAgentReport(db, meeting.id, reportAgentId as AgentId, key);
      if (!baselineReport) {
        await saveExperimentMeetingResult(
          db,
          experimentId,
          meeting.id,
          { eligible: false, ineligibleReason: 'Sem relatório oficial desta reunião.' },
          key,
        );
        continue;
      }

      const review = await loadTranscriptReview(db, meeting.id, key).catch(() => null);
      const finals = review ? review.content.split(/\r?\n+/).filter(Boolean) : await listTranscriptFinals(db, meeting.id, key);
      // só agentId/text importam aqui (generateCounselorReport filtra por agentId e cita o texto) —
      // type/severity viram placeholder, o registro persistido é mais amplo que o contrato ao vivo.
      const contributions = (await listMeetingContributions(db, meeting.id, key).catch(() => [])).map((c) => ({
        agentId: c.agentId,
        type: 'sugestao' as const,
        severity: 'normal' as const,
        text: c.text,
      }));

      const startedAt = Date.now();
      let candidateText: string;
      try {
        if (experiment.targetType === 'counselor') {
          candidateText = await generateCounselorReport(
            llm,
            user.companyId,
            reportAgentId as AgentId,
            finals,
            contributions,
            experiment.candidateModel,
            experiment.candidateReasoningEffort,
          );
        } else {
          // síntese final REAL parte dos 8 relatórios já oficiais desta reunião — evidência imutável, nunca recriada aqui.
          const counselorReports = (await listAgentReports(db, meeting.id, key)).filter((r) => r.agentId !== 'presidente');
          candidateText = await generatePresidentSynthesis(
            llm,
            user.companyId,
            counselorReports.map((r) => ({ agentId: r.agentId, content: r.content })),
            experiment.candidateModel,
            experiment.candidateReasoningEffort,
          );
        }
      } catch (err) {
        await saveExperimentMeetingResult(
          db,
          experimentId,
          meeting.id,
          { eligible: false, ineligibleReason: err instanceof Error ? err.message : 'Falha ao gerar a versão candidata.' },
          key,
        );
        continue;
      }
      const latencyMs = Date.now() - startedAt;
      const costUsd =
        (lastUsage.inputTokens / 1_000_000) * PRICING.llmInputPerMTok +
        (lastUsage.outputTokens / 1_000_000) * PRICING.llmOutputPerMTok;

      const comparison = await compareReportQuality(
        llm,
        finals.slice(0, 20).join(' ').slice(0, 2000),
        baselineReport.content,
        candidateText,
      );

      if (comparison) {
        qualityDeltas.push(comparison.candidateScore - comparison.baselineScore);
        costDeltas.push(costUsd); // custo absoluto do candidato (baseline não é re-rodado — Seção 53)
      }

      await saveExperimentMeetingResult(
        db,
        experimentId,
        meeting.id,
        {
          eligible: true,
          baselineScore: comparison?.baselineScore ?? null,
          candidateScore: comparison?.candidateScore ?? null,
          candidateCostUsd: costUsd,
          candidateLatencyMs: latencyMs,
          candidateInputTokens: lastUsage.inputTokens,
          candidateOutputTokens: lastUsage.outputTokens,
          candidateText,
          note: comparison?.note ?? null,
        },
        key,
      );
    }

    const avgQualityDelta = qualityDeltas.length > 0 ? qualityDeltas.reduce((a, b) => a + b, 0) / qualityDeltas.length : null;
    // custo relativo: sem re-rodar a baseline não há "delta %" real — reportamos null
    // (Seção 34/53: nunca fabricar um delta de custo sem uma baseline medida na mesma unidade).
    const result = classifyExperimentResult(avgQualityDelta, null);
    await completeExperiment(db, experimentId, result);
    revalidatePath(`/improvements/experiments/${experimentId}`);
    revalidatePath('/improvements');
    return { ok: 'Experimento concluído.' };
  } catch (err) {
    console.error('[experimentos] rodar falhou:', err);
    await setExperimentStatus(db, experimentId, 'failed').catch(() => {});
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao rodar o experimento.' };
  }
}

/** "Aplicar em produção" (Seção 36) — aplica o modelo/raciocínio candidato ao alvo REAL, via os MESMOS caminhos de escrita já auditados. */
export async function promoteExperimentAction(
  _prev: ExperimentActionState,
  formData: FormData,
): Promise<ExperimentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem aplicar experimentos em produção.' };
  const experimentId = String(formData.get('experimentId') ?? '');
  if (!experimentId) return { error: 'Experimento inválido.' };

  const db = await getDb();
  const experiment = await getExperiment(db, user.companyId, experimentId);
  if (!experiment) return { error: 'Experimento não encontrado.' };
  if (experiment.status !== 'completed') return { error: 'Só é possível aplicar um experimento concluído.' };

  try {
    if (experiment.targetType === 'counselor' && experiment.targetAgentId) {
      await loadAndApplyProfileOverrides(db, user.companyId);
      const profile = getAgentProfiles(user.companyId)[experiment.targetAgentId];
      if (!profile) return { error: 'Conselheiro não encontrado mais.' };
      const { scopeCan, scopeCannot } = await loadScopeSplit(db, user.companyId, experiment.targetAgentId);
      await saveAgentProfile(db, user.companyId, experiment.targetAgentId, profile.displayName, scopeCan, scopeCannot, {
        iconKey: profile.iconKey,
        iconColor: profile.iconColor,
        professionalProfile: profile.professionalProfile,
        decisionCriteria: profile.decisionCriteria,
        riskPosture: profile.riskPosture,
        riskPostureNotes: profile.riskPostureNotes,
        aiModel: experiment.candidateModel,
        reasoningEffort: experiment.candidateReasoningEffort,
        voice: profile.voice,
        voiceInstructions: profile.voiceInstructions,
        speechRate: profile.speechRate,
      });
    } else {
      await loadAndApplyPresidentConfig(db, user.companyId);
      const config = getPresidentConfig(user.companyId);
      await savePresidentConfig(db, user.companyId, {
        monitoringModel: config.monitoringModel,
        monitoringReasoningEffort: config.monitoringReasoningEffort,
        synthesisModel: experiment.candidateModel,
        synthesisReasoningEffort: experiment.candidateReasoningEffort,
        finalSynthesisReasoningEffort: config.finalSynthesisReasoningEffort,
        interventionLevel: config.interventionLevel,
        canRequestCounselors: config.canRequestCounselors,
        canRegisterDecisions: config.canRegisterDecisions,
        canOverrideSpecialist: config.canOverrideSpecialist,
        autoInterruption: config.autoInterruption,
      });
    }
    await promoteExperiment(db, experimentId, user.id);
    revalidatePath(`/improvements/experiments/${experimentId}`);
    revalidatePath('/counselors');
    return { ok: 'Configuração aplicada em produção.' };
  } catch (err) {
    console.error('[experimentos] promover falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao aplicar em produção.' };
  }
}
