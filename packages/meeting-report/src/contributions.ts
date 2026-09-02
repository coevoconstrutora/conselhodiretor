import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import type { AgentContribution, AgentId } from '@conselho/providers';

/**
 * Histórico DURÁVEL de contribuições do board (Etapa "Histórico de
 * reuniões", Seção 8) — antes desta migration, só a SÍNTESE do Presidente
 * era persistida por contribuição (`board_synthesis`); as contribuições
 * REGULARES dos 8 conselheiros só viviam em memória (`runtime.active`),
 * perdidas ao reiniciar ou expirar o TTL. Sem `writeAudit` por linha — a
 * sessão já audita uma vez em `transcript-persist-start`/por card
 * individual quando aplicável (full-board.ts já audita cada contribuição
 * emitida); esta tabela é o REGISTRO HISTÓRICO consultável, não mais uma
 * trilha de auditoria.
 */

export interface MeetingContributionRecord {
  readonly id: string;
  readonly meetingId: string;
  readonly agentId: AgentId;
  readonly type: string;
  readonly severity: string;
  readonly urgency: string | null;
  readonly category: string | null;
  readonly text: string;
  readonly headline: string | null;
  readonly recommendation: string | null;
  readonly question: string | null;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
}

/** Persiste 1 contribuição do board (fire-and-forget no call site — nunca deve derrubar a reunião). */
export async function saveMeetingContribution(
  db: SqlExecutor,
  meetingId: string,
  contribution: AgentContribution,
  encryptionKey: Buffer,
): Promise<void> {
  const contentEnc = encryptField(
    JSON.stringify({
      text: contribution.text,
      headline: contribution.headline ?? null,
      recommendation: contribution.recommendation ?? null,
      question: contribution.question ?? null,
    }),
    encryptionKey,
  );
  await db.query(
    `INSERT INTO meeting_contribution
       (meeting_id, agent_id, type, severity, urgency, category, content_enc, model_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      meetingId,
      contribution.agentId,
      contribution.type,
      contribution.severity,
      contribution.urgency ?? null,
      contribution.category ?? null,
      contentEnc,
      contribution.modelVersion ?? null,
    ],
  );
}

/** Contribuições da reunião, em ordem cronológica — para a aba "Contribuições" do histórico. */
export async function listMeetingContributions(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<MeetingContributionRecord[]> {
  const res = await db.query<{
    id: string;
    agent_id: string;
    type: string;
    severity: string;
    urgency: string | null;
    category: string | null;
    content_enc: string;
    model_version: string | null;
    created_at: Date | string;
  }>(
    `SELECT id, agent_id, type, severity, urgency, category, content_enc, model_version, created_at
     FROM meeting_contribution WHERE meeting_id = $1 ORDER BY created_at ASC`,
    [meetingId],
  );
  return res.rows.flatMap((r) => {
    let parsed: { text: string; headline: string | null; recommendation: string | null; question: string | null };
    try {
      parsed = JSON.parse(decryptField(r.content_enc, encryptionKey));
    } catch {
      return []; // linha corrompida/chave rotacionada — pula, não derruba a aba
    }
    return [
      {
        id: r.id,
        meetingId,
        agentId: r.agent_id as AgentId,
        type: r.type,
        severity: r.severity,
        urgency: r.urgency,
        category: r.category,
        text: parsed.text,
        headline: parsed.headline,
        recommendation: parsed.recommendation,
        question: parsed.question,
        modelVersion: r.model_version,
        createdAt: new Date(r.created_at),
      },
    ];
  });
}

/** Contagem por agente (cards históricos — Seção 6: "N contribuições"/"Não acionado"), sem decifrar. */
export async function countMeetingContributionsByAgent(
  db: SqlExecutor,
  meetingId: string,
): Promise<Map<AgentId, number>> {
  const res = await db.query<{ agent_id: string; count: string | number }>(
    'SELECT agent_id, COUNT(*) AS count FROM meeting_contribution WHERE meeting_id = $1 GROUP BY agent_id',
    [meetingId],
  );
  return new Map(res.rows.map((r) => [r.agent_id as AgentId, Number(r.count)]));
}
