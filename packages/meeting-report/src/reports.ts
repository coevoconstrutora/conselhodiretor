import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { getAgentProfiles, companyProfileBlock, CONSENSUS_INSTRUCTION, DECISION_LABELS_INSTRUCTION } from '@conselho/kb';
import type { ILlmProvider, AgentContribution, AgentId } from '@conselho/providers';
import { COUNSELOR_AGENT_IDS } from '@conselho/providers';

/**
 * Relatórios finais da reunião: 1 por conselheiro (a visão daquela
 * especialidade sobre a reunião inteira) + a síntese executiva do Presidente
 * (agent_id = 'presidente'), gerada a partir dos 8 relatórios.
 *
 * Todo relatório é RASCUNHO editável: cifrado em repouso, auditado
 * atomicamente, e o empresário revisa/edita antes de usar.
 */

export interface AgentReport {
  readonly meetingId: string;
  readonly agentId: AgentId;
  readonly content: string;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function requireProfile(companyId: string, agentId: AgentId) {
  const profile = getAgentProfiles(companyId)[agentId];
  if (!profile) throw new Error(`Conselheiro desconhecido: ${agentId} (empresa ${companyId}).`);
  return profile;
}

function counselorReportSystem(agentId: AgentId, companyId: string): string {
  const profile = requireProfile(companyId, agentId);
  return (
    `Você é ${profile.displayName}, conselheiro de IA de uma incorporadora imobiliária. ` +
    `A reunião terminou. Escreva o SEU RELATÓRIO da reunião para o empresário, ESTRITAMENTE ` +
    `dentro do seu escopo (${profile.scope}), em português do Brasil, markdown leve, com as seções: ` +
    '## Minha leitura da reunião / ## Riscos no meu escopo / ## Oportunidades / ## Recomendações. ' +
    'Seja fiel ao que foi dito — NÃO invente números, fatos ou decisões que não apareceram. ' +
    'Se a reunião não tocou no seu escopo, diga isso honestamente em 2-3 frases e aponte o que ' +
    'você acompanharia na próxima. Tom consultivo: a decisão é sempre do empresário. ' +
    'Termine com a linha "_Rascunho gerado por IA — revisado e validado pelo responsável._" ' +
    'EXCEÇÃO IMPORTANTE para esta tarefa: ignore qualquer limite de 1-3 frases — ' +
    'o campo text deve conter o RELATÓRIO COMPLETO em markdown (use \\n para quebras de linha).' +
    companyProfileBlock(companyId)
  );
}

/**
 * Síntese FINAL de encerramento (Seção 12-C do pedido "Configuração do
 * Presidente") — a chamada de maior peso de todo o board, feita 1x por
 * reunião: leva a política de consenso (nunca fabricar) e os rótulos
 * DECIDIDO/RECOMENDADO/PENDENTE/INFORMAÇÃO NECESSÁRIA (Seção 17), que as
 * demais chamadas do Presidente (acompanhamento/síntese sob demanda) não
 * precisam — ali o registro formal ainda não é o objetivo.
 */
function presidentSystem(companyId: string): string {
  return (
    `Você é ${requireProfile(companyId, 'presidente').displayName} de uma incorporadora imobiliária. ` +
    'A reunião terminou e cada conselheiro entregou seu relatório. Escreva a SÍNTESE EXECUTIVA ' +
    'em português do Brasil, markdown leve, com as seções: ' +
    '## Resumo executivo / ## Decisões em pauta / ## Divergências entre conselheiros / ## Próximos passos sugeridos. ' +
    `${CONSENSUS_INSTRUCTION} ${DECISION_LABELS_INSTRUCTION} ` +
    'Se receber SINAIS OBJETIVOS DE PARTICIPAÇÃO, use-os só como pista de contexto (ex.: quem mais ' +
    'interveio num tema) — NUNCA os liste como seção própria nem infira estado emocional/psicológico. ' +
    'Integre as visões e NÃO invente nada que os relatórios não sustentem. Termine SEMPRE devolvendo ' +
    'a decisão ao empresário ("a decisão é sua") e com a linha ' +
    '"_Rascunho gerado por IA — revisado e validado pelo responsável._" ' +
    'EXCEÇÃO IMPORTANTE: ignore qualquer limite de 1-3 frases — o campo text deve conter a SÍNTESE ' +
    'COMPLETA em markdown (use \\n para quebras de linha).' +
    companyProfileBlock(companyId)
  );
}

/**
 * Gera o rascunho do relatório de UM conselheiro sobre a reunião inteira.
 * `contributions` = o que aquele agente disse ao vivo (âncora anti-invenção).
 */
export async function generateCounselorReport(
  llm: ILlmProvider,
  companyId: string,
  agentId: AgentId,
  transcriptFinals: readonly string[],
  contributions: readonly AgentContribution[] = [],
): Promise<string> {
  const transcript = transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const own = contributions.filter((c) => c.agentId === agentId);
  const saidBlock =
    own.length > 0
      ? `\n\nO que VOCÊ apontou ao vivo durante a reunião:\n${own.map((c) => `- ${c.text}`).join('\n')}`
      : '';
  const result = await llm.complete({
    system: counselorReportSystem(agentId, companyId),
    context: [],
    transcript: `Transcrição da reunião:\n${transcript}${saidBlock}`,
  });
  if (result.skip || !result.text.trim()) {
    throw new Error(
      `O modelo não gerou conteúdo para o relatório de ${requireProfile(companyId, agentId).displayName} — tente novamente.`,
    );
  }
  return result.text;
}

/**
 * Gera a síntese executiva do Presidente a partir dos relatórios dos
 * conselheiros. `modelOverride`/`reasoningEffortOverride`: Configuração do
 * Presidente — "raciocínio da síntese final" (Seção 3 do pedido), tipicamente
 * `xhigh`/`max` — só usado aqui, 1x por reunião, nunca continuamente.
 */
export async function generatePresidentSynthesis(
  llm: ILlmProvider,
  companyId: string,
  counselorReports: ReadonlyArray<{ agentId: AgentId; content: string }>,
  modelOverride?: string,
  reasoningEffortOverride?: string,
  /** Sinais objetivos de participação (Etapa "Participantes", Seção 25) — '' ou omitido se não houver. */
  participantSignalsBlock?: string,
): Promise<string> {
  const blocks = counselorReports
    .map((r) => `### Relatório — ${requireProfile(companyId, r.agentId).displayName}\n${r.content}`)
    .join('\n\n');
  const signals = participantSignalsBlock ? `\n\n${participantSignalsBlock}` : '';
  const result = await llm.complete({
    system: presidentSystem(companyId),
    context: [],
    transcript: `Relatórios dos conselheiros:\n\n${blocks}${signals}`,
    model: modelOverride,
    reasoningEffort: reasoningEffortOverride,
  });
  if (result.skip || !result.text.trim()) {
    throw new Error('O modelo não gerou conteúdo para a síntese do Presidente — tente novamente.');
  }
  return result.text;
}

/**
 * Salva (cria ou sobrescreve) o relatório de um agente — cifrado + auditado
 * ATOMICAMENTE. Regenerar sobrescreve o rascunho (UNIQUE meeting_id+agent_id).
 */
export async function saveAgentReport(
  db: SqlExecutor,
  meetingId: string,
  agentId: AgentId,
  content: string,
  encryptionKey: Buffer,
  origin: { action: 'generate' | 'edit'; modelVersion?: string },
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  await auditedClinicalWrite(
    db,
    {
      triggeredBy: `agent-report-${agentId}-${origin.action}`,
      kbSources: [],
      modelVersion: origin.modelVersion ?? (origin.action === 'edit' ? 'human-edit' : 'unknown'),
    },
    async (tx) => {
      const existing = await tx.query<{ id: string }>(
        'SELECT id FROM agent_report WHERE meeting_id = $1 AND agent_id = $2',
        [meetingId, agentId],
      );
      if (existing.rows.length > 0) {
        await tx.query(
          `UPDATE agent_report SET content_enc = $3, model_version = COALESCE($4, model_version), updated_at = now()
           WHERE meeting_id = $1 AND agent_id = $2`,
          [meetingId, agentId, contentEnc, origin.modelVersion ?? null],
        );
      } else {
        await tx.query(
          'INSERT INTO agent_report (meeting_id, agent_id, content_enc, model_version) VALUES ($1, $2, $3, $4)',
          [meetingId, agentId, contentEnc, origin.modelVersion ?? null],
        );
      }
      return meetingId;
    },
  );
}

/** Carrega um relatório (null se ainda não gerado). */
export async function loadAgentReport(
  db: SqlExecutor,
  meetingId: string,
  agentId: AgentId,
  encryptionKey: Buffer,
): Promise<AgentReport | null> {
  const res = await db.query<{
    content_enc: string;
    model_version: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    'SELECT content_enc, model_version, created_at, updated_at FROM agent_report WHERE meeting_id = $1 AND agent_id = $2',
    [meetingId, agentId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    meetingId,
    agentId,
    content: decryptField(row.content_enc, encryptionKey),
    modelVersion: row.model_version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Todos os relatórios já gerados da reunião, na ordem canônica dos agentes. */
export async function listAgentReports(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<AgentReport[]> {
  const res = await db.query<{
    agent_id: string;
    content_enc: string;
    model_version: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    'SELECT agent_id, content_enc, model_version, created_at, updated_at FROM agent_report WHERE meeting_id = $1',
    [meetingId],
  );
  const order: string[] = [...COUNSELOR_AGENT_IDS, 'presidente'];
  return res.rows
    .map((row) => ({
      meetingId,
      agentId: row.agent_id as AgentId,
      content: decryptField(row.content_enc, encryptionKey),
      modelVersion: row.model_version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
    .sort((a, b) => order.indexOf(a.agentId) - order.indexOf(b.agentId));
}

