'use server';

import { revalidatePath } from 'next/cache';
import {
  generateCounselorReport,
  generatePresidentSynthesis,
  saveAgentReport,
  listAgentReports,
} from '@conselho/meeting-report';
import { COUNSELOR_AGENT_IDS, type AgentId, ALL_AGENT_IDS } from '@conselho/providers';
import { AnthropicLlmProvider } from '@conselho/llm-anthropic';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getNoteInputs } from './board-runtime';
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, code: 'internal', detail: 'ANTHROPIC_API_KEY ausente no servidor.' };
  }
  try {
    const inputs = await getNoteInputs(meetingId);
    if (!inputs || inputs.finals.length === 0) return { ok: false, code: 'no-transcript' };

    const db = await getDb();
    const key = getEncryptionKey();
    const llm = new AnthropicLlmProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      agentId: 'presidente',
      longForm: true,
      // Relatório completo (4 seções em markdown) escapado dentro de um campo
      // JSON de string: 1500 tokens cortava a resposta no meio, gerando JSON
      // inválido (aspas/chaves nunca fechadas). 4000 dá folga real.
      maxTokens: 4000,
    });

    // 1 relatório por conselheiro, em série (evita rajada de 8 chamadas simultâneas)
    const reports: Array<{ agentId: AgentId; content: string }> = [];
    for (const agentId of COUNSELOR_AGENT_IDS) {
      const content = await generateCounselorReport(llm, agentId, inputs.finals, inputs.contributions);
      await saveAgentReport(db, meetingId, agentId, content, key, {
        action: 'generate',
        modelVersion: 'claude-haiku-4-5',
      });
      reports.push({ agentId, content });
    }

    // síntese executiva do Presidente a partir dos 8 relatórios
    const synthesis = await generatePresidentSynthesis(llm, reports);
    await saveAgentReport(db, meetingId, 'presidente', synthesis, key, {
      action: 'generate',
      modelVersion: 'claude-haiku-4-5',
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
