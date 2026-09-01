import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import type { ILlmProvider, AgentContribution } from '@conselho/providers';

/**
 * Aprendizado do PRODUTO (não do negócio da empresa): a cada reunião
 * encerrada, uma análise automática aponta o que daria pra melhorar no
 * PRÓPRIO Conselho nesta reunião (gatilhos, repetição de fórmula, tom,
 * lacuna de KB) — só leitura por enquanto (tela /melhorias), nada aqui é
 * aplicado sozinho no sistema.
 */

export interface MeetingImprovement {
  readonly id: string;
  readonly meetingId: string;
  readonly meetingTitle: string;
  readonly content: string;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
}

const SYSTEM_PROMPT =
  'Você é um analista de produto avaliando o CONSELHO — um sistema de IA com vários agentes ' +
  'consultores que participam ao vivo de reuniões de diretoria de uma incorporadora. NÃO avalie ' +
  'o negócio da empresa nem dê conselhos de negócio: avalie o PRÓPRIO SISTEMA nesta reunião ' +
  'específica. Com base na transcrição e nas contribuições dos agentes fornecidas, aponte ' +
  'objetivamente o que daria para melhorar no produto, quando aplicável, por exemplo: gatilhos ' +
  'disparando com pouco contexto ou cedo demais; agentes repetindo a mesma abertura de frase ou ' +
  'fórmula genérica ("vale verificar", "considere"); contribuições que se sobrepõem ou pisam na ' +
  'fala umas das outras; agente saindo do escopo; lacuna aparente na base de conhecimento daquele ' +
  'agente; falta de uma pergunta quando uma pergunta teria sido mais útil que uma afirmação. ' +
  'Responda em português do Brasil, markdown leve, curto e objetivo (bullet points, no máximo ' +
  '6-8 itens). Se a reunião não revelou nenhum problema de sistema digno de nota, diga isso em ' +
  '1-2 frases. NUNCA sugira mudança de negócio/estratégia da empresa — só do comportamento do ' +
  'sistema em si.';

/** Roda a análise (LLM) — retorna `null` sem transcrição/contribuições ou se o modelo não gerou nada. */
export async function analyzeMeetingForImprovements(
  llm: ILlmProvider,
  transcriptFinals: readonly string[],
  contributions: readonly AgentContribution[],
): Promise<string | null> {
  if (transcriptFinals.length === 0 && contributions.length === 0) return null;
  const transcript = transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const contributionsBlock = contributions
    .map((c) => `[${c.agentId}] (${c.type}) ${c.text}`)
    .join('\n');
  const result = await llm.complete({
    system: SYSTEM_PROMPT,
    context: [],
    transcript: `Transcrição da reunião:\n${transcript}\n\nContribuições dos agentes ao vivo:\n${contributionsBlock}`,
  });
  if (result.skip || !result.text.trim()) return null;
  return result.text;
}

/** Persiste a análise — cifrada + auditada atomicamente, mesmo padrão dos relatórios. */
export async function saveMeetingImprovement(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  content: string,
  encryptionKey: Buffer,
  modelVersion?: string,
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'meeting-improvement-analysis', kbSources: [], modelVersion: modelVersion ?? 'unknown' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO meeting_improvement (meeting_id, company_id, content_enc, model_version)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [meetingId, companyId, contentEnc, modelVersion ?? null],
      );
      return res.rows[0]!.id;
    },
  );
}

/** Análises mais recentes da empresa (todas as reuniões), pra tela /melhorias. */
export async function listMeetingImprovements(
  db: SqlExecutor,
  companyId: string,
  encryptionKey: Buffer,
  limit = 50,
): Promise<MeetingImprovement[]> {
  const res = await db.query<{
    id: string;
    meeting_id: string;
    title_enc: string;
    content_enc: string;
    model_version: string | null;
    created_at: Date | string;
  }>(
    `SELECT mi.id, mi.meeting_id, m.title_enc, mi.content_enc, mi.model_version, mi.created_at
     FROM meeting_improvement mi
     JOIN meeting m ON m.id = mi.meeting_id
     WHERE mi.company_id = $1
     ORDER BY mi.created_at DESC
     LIMIT $2`,
    [companyId, limit],
  );
  return res.rows.flatMap((row) => {
    try {
      return [
        {
          id: row.id,
          meetingId: row.meeting_id,
          meetingTitle: decryptField(row.title_enc, encryptionKey),
          content: decryptField(row.content_enc, encryptionKey),
          modelVersion: row.model_version,
          createdAt: new Date(row.created_at),
        },
      ];
    } catch {
      return []; // linha corrompida/chave rotacionada — pula, não derruba a tela
    }
  });
}
