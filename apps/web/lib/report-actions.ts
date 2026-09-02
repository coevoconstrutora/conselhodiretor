'use server';

import { revalidatePath } from 'next/cache';
import {
  generateCounselorReport,
  generatePresidentSynthesis,
  saveAgentReport,
  listAgentReports,
  extractMeetingOutcome,
  saveMeetingOutcome,
} from '@conselho/meeting-report';
import { meetingBelongsToCompany, getMeeting } from '@conselho/meetings';
import { PRESIDENT_AGENT_ID, type AgentId } from '@conselho/providers';
import { getAgentProfiles } from '@conselho/kb';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getNoteInputs } from './board-runtime';
import { createLlm } from './llm';
import { toActionResult, type ActionResult } from './action-result';
import { loadAndApplyProfileOverrides } from './kb-sources';
import { loadAndApplyPresidentConfig, getPresidentConfig } from './president-config-store';
import { listMeetingParticipantSignals, formatParticipantSignalsBlock } from './meeting-speakers';
import { buildReportsPdf } from './report-export';
import { sendReportsEmail } from './email';

export type CounselorEmailState = { error?: string; ok?: string } | null;

/**
 * Gera os relatórios finais da reunião: 1 por conselheiro (visão da
 * especialidade) e, ao final, a síntese executiva do Presidente a partir dos
 * 8 relatórios. Todos cifrados + auditados; regenerar sobrescreve o rascunho.
 * Fluxo de alto risco (LLM em série) ⇒ ActionResult, nunca lança.
 */
export async function generateReportsAction(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (!canWrite(user)) return { ok: false, code: 'unauthenticated', detail: 'Convidados não podem gerar relatórios.' };
  if (!meetingId) return { ok: false, code: 'invalid-input' };
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, code: 'internal', detail: 'Nenhuma chave de LLM (OPENAI_API_KEY/GEMINI_API_KEY/ANTHROPIC_API_KEY) no servidor.' };
  }
  try {
    const db = await getDb();
    if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
      return { ok: false, code: 'invalid-input' };
    }
    const inputs = await getNoteInputs(meetingId);
    if (!inputs || inputs.finals.length === 0) return { ok: false, code: 'no-transcript' };

    const key = getEncryptionKey();
    // Factory única (lib/llm.ts): Gemini > Anthropic, trocável por env.
    // longForm + teto alto: relatório completo em markdown escapado num campo
    // JSON de string — 1500 tokens cortava a resposta no meio (JSON inválido).
    const { llm, label: modelLabel } = createLlm({ longForm: true, maxTokens: 4000 });

    // roster REAL da empresa (padrão + custom) — nunca uma lista fixa, senão
    // um conselheiro custom nunca ganharia relatório (Etapa 20)
    await loadAndApplyProfileOverrides(db, user.companyId);
    const counselorAgentIds = Object.keys(getAgentProfiles(user.companyId)).filter(
      (id) => id !== PRESIDENT_AGENT_ID,
    ) as AgentId[];

    // 1 relatório por conselheiro, em série (evita rajada de N chamadas simultâneas)
    const reports: Array<{ agentId: AgentId; content: string }> = [];
    for (const agentId of counselorAgentIds) {
      const content = await generateCounselorReport(llm, user.companyId, agentId, inputs.finals, inputs.contributions);
      await saveAgentReport(db, meetingId, agentId, content, key, {
        action: 'generate',
        modelVersion: modelLabel,
      });
      reports.push({ agentId, content });
    }

    // síntese executiva do Presidente a partir dos 8 relatórios — "raciocínio
    // da síntese final" da Configuração do Presidente (tipicamente xhigh/max,
    // só aqui, 1x por reunião).
    await loadAndApplyPresidentConfig(db, user.companyId);
    const presidentConfig = getPresidentConfig(user.companyId);
    const participantSignals = await listMeetingParticipantSignals(db, meetingId);
    const synthesis = await generatePresidentSynthesis(
      llm,
      user.companyId,
      reports,
      presidentConfig.synthesisModel,
      presidentConfig.finalSynthesisReasoningEffort,
      formatParticipantSignalsBlock(participantSignals),
    );
    await saveAgentReport(db, meetingId, 'presidente', synthesis, key, {
      action: 'generate',
      modelVersion: modelLabel,
    });

    // Decision Ledger + Ações (Etapa "Histórico de reuniões") — extraídos da
    // síntese final, mesma chamada de trabalho. Nunca lança: falha aqui não
    // derruba a geração dos relatórios, a reunião só fica sem essas 2 abas.
    const outcome = await extractMeetingOutcome(
      llm,
      synthesis,
      presidentConfig.synthesisModel,
      presidentConfig.synthesisReasoningEffort,
    );
    if (outcome) {
      await saveMeetingOutcome(db, meetingId, outcome, key).catch((error) =>
        console.error('[relatorios] salvar decisões/ações falhou:', error),
      );
    }

    revalidatePath(`/meetings/${meetingId}`);
    return { ok: true };
  } catch (err) {
    console.error('[relatorios] geração falhou:', err);
    return toActionResult(err);
  }
}

/** Salva a edição humana de um relatório (baixo risco — form simples, lança). */
export async function saveAgentReportAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem editar relatórios.');
  const meetingId = String(formData.get('meetingId') ?? '');
  const agentId = String(formData.get('agentId') ?? '') as AgentId;
  const content = String(formData.get('content') ?? '').trim();
  if (!meetingId || !content) throw new Error('Dados incompletos.');
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    throw new Error('Reunião não encontrada.');
  }
  await loadAndApplyProfileOverrides(db, user.companyId);
  if (!getAgentProfiles(user.companyId)[agentId]) throw new Error('Agente inválido.');
  await saveAgentReport(db, meetingId, agentId, content, getEncryptionKey(), { action: 'edit' });
  revalidatePath(`/meetings/${meetingId}`);
}

/** Relatórios já gerados (para a página da reunião). */
export async function loadReports(meetingId: string) {
  const db = await getDb();
  return listAgentReports(db, meetingId, getEncryptionKey());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Envia os relatórios (PDF anexado) por e-mail — reaproveita a infra do Resend. */
export async function sendReportsEmailAction(
  _prev: CounselorEmailState,
  formData: FormData,
): Promise<CounselorEmailState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem enviar relatórios.' };
  const meetingId = String(formData.get('meetingId') ?? '');
  const to = String(formData.get('to') ?? '').trim();
  if (!meetingId) return { error: 'Reunião inválida.' };
  if (!EMAIL_RE.test(to)) return { error: 'Informe um e-mail válido.' };
  try {
    const db = await getDb();
    const key = getEncryptionKey();
    const meeting = await getMeeting(db, meetingId, user.companyId, key);
    if (!meeting) return { error: 'Reunião não encontrada.' };
    const reports = await listAgentReports(db, meetingId, key);
    if (reports.length === 0) return { error: 'Gere os relatórios antes de enviar por e-mail.' };
    await loadAndApplyProfileOverrides(db, user.companyId);
    const profiles = getAgentProfiles(user.companyId);
    const items = reports.map((r) => ({
      agentId: r.agentId,
      displayName: profiles[r.agentId]?.displayName ?? r.agentId,
      content: r.content,
      updatedAt: r.updatedAt,
    }));
    const pdf = await buildReportsPdf(meeting.title, items);
    await sendReportsEmail(to, meeting.title, pdf);
    return { ok: `Relatórios enviados para ${to}.` };
  } catch (err) {
    console.error('[relatorios] envio por e-mail falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao enviar o e-mail.' };
  }
}
