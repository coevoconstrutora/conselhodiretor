'use server';

import { revalidatePath } from 'next/cache';
import {
  generateCounselorReport,
  generatePresidentSynthesis,
  saveAgentReport,
  listAgentReports,
} from '@conselho/meeting-report';
import { COUNSELOR_AGENT_IDS, type AgentId, ALL_AGENT_IDS } from '@conselho/providers';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getNoteInputs } from './board-runtime';
import { createLlm } from './llm';
import { toActionResult, type ActionResult } from './action-result';

/**
 * Gera os relatórios finais da reunião: 1 por conselheiro (visão da
 * especialidade) e, ao final, a síntese executiva do Presidente a partir dos
 * 8 relatórios. Todos cifrados + auditados; regenerar sobrescreve o rascunho.
 * Fluxo de alto risco (LLM em série) ⇒ ActionResult, nunca lança.
 */
export async function generateReportsAction(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (!meetingId) return { ok: false, code: 'invalid-input' };
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, code: 'internal', detail: 'Nenhuma chave de LLM (GEMINI_API_KEY/ANTHROPIC_API_KEY) no servidor.' };
  }
  try {
    const inputs = await getNoteInputs(meetingId);
    if (!inputs || inputs.finals.length === 0) return { ok: false, code: 'no-transcript' };

    const db = await getDb();
    const key = getEncryptionKey();
    // Factory única (lib/llm.ts): Gemini > Anthropic, trocável por env.
    // longForm + teto alto: relatório completo em markdown escapado num campo
    // JSON de string — 1500 tokens cortava a resposta no meio (JSON inválido).
    const { llm, label: modelLabel } = createLlm({ longForm: true, maxTokens: 4000 });

    // 1 relatório por conselheiro, em série (evita rajada de 8 chamadas simultâneas)
    const reports: Array<{ agentId: AgentId; content: string }> = [];
    for (const agentId of COUNSELOR_AGENT_IDS) {
      const content = await generateCounselorReport(llm, agentId, inputs.finals, inputs.contributions);
      await saveAgentReport(db, meetingId, agentId, content, key, {
        action: 'generate',
        modelVersion: modelLabel,
      });
      reports.push({ agentId, content });
    }

    // síntese executiva do Presidente a partir dos 8 relatórios
    const synthesis = await generatePresidentSynthesis(llm, reports);
    await saveAgentReport(db, meetingId, 'presidente', synthesis, key, {
      action: 'generate',
      modelVersion: modelLabel,
    });

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
  const meetingId = String(formData.get('meetingId') ?? '');
  const agentId = String(formData.get('agentId') ?? '') as AgentId;
  const content = String(formData.get('content') ?? '').trim();
  if (!meetingId || !content) throw new Error('Dados incompletos.');
  if (!(ALL_AGENT_IDS as readonly string[]).includes(agentId)) throw new Error('Agente inválido.');
  const db = await getDb();
  await saveAgentReport(db, meetingId, agentId, content, getEncryptionKey(), { action: 'edit' });
  revalidatePath(`/meetings/${meetingId}`);
}

/** Relatórios já gerados (para a página da reunião). */
export async function loadReports(meetingId: string) {
  const db = await getDb();
  return listAgentReports(db, meetingId, getEncryptionKey());
}
