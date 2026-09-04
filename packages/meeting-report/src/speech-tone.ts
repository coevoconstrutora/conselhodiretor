import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import type { ILlmProvider } from '@conselho/providers';

/**
 * "Tom da linguagem" por participante (Etapa "Análise de fala dos
 * presentes") — ÚNICA exceção deliberada, no produto inteiro, à política de
 * nunca inferir estado emocional/psicológico (pedido explícito do
 * empresário, ver `packages/kb/src/president-config.ts`). Por isso fica
 * ISOLADA: tabela própria (`participant_speech_tone`, nunca
 * `participant_meeting_analytics`), opt-in por empresa
 * (`PresidentConfig.speechToneAnalysisEnabled`, default false) e NUNCA
 * alimenta a síntese do Presidente — só aparece na página do participante.
 */

const SPEECH_TONE_SYSTEM =
  'Você analisa o ESTILO de linguagem de UMA pessoa a partir de trechos do que ela disse numa reunião ' +
  'de negócios. Descreva só o FRASEADO observável: direto vs. hesitante, afirmativo vs. interrogativo, ' +
  'uso de dados/números vs. opinião, objetivo vs. exploratório. NUNCA nomeie emoção, humor, estado ' +
  'psicológico, intenção oculta ou traço de personalidade — isso NÃO é uma avaliação de caráter nem um ' +
  'diagnóstico. 2-3 frases, português do Brasil, tom descritivo e neutro. Termine SEMPRE com a linha ' +
  '"_Leitura aproximada de estilo de linguagem gerada por IA — não é uma avaliação psicológica._"';

/**
 * `null` quando não há fala suficiente ou o provider não implementa
 * `completeText` (mesmo guard defensivo de `generateMeetingAnalysis`,
 * `improvements.ts`) — nunca lança, o disparo é sempre fire-and-forget.
 */
export async function generateSpeechTone(
  llm: ILlmProvider,
  participantName: string,
  utterances: readonly string[],
  modelOverride?: string,
  reasoningEffortOverride?: string,
): Promise<string | null> {
  if (utterances.length === 0 || typeof llm.completeText !== 'function') return null;
  const res = await llm.completeText({
    system: SPEECH_TONE_SYSTEM,
    prompt: `Trechos do que ${participantName} disse nesta reunião:\n${utterances.map((u) => `- ${u}`).join('\n')}`,
    maxTokens: 400,
    model: modelOverride,
    reasoningEffort: reasoningEffortOverride,
  });
  const text = res.text.trim();
  return text || null;
}

/** Salva (cria ou sobrescreve) a leitura de tom de UM participante nesta reunião — cifrada + auditada. */
export async function saveSpeechTone(
  db: SqlExecutor,
  meetingId: string,
  participantId: string,
  content: string,
  encryptionKey: Buffer,
  modelVersion?: string,
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'speech-tone-analysis', kbSources: [], modelVersion: modelVersion ?? 'unknown' },
    async (tx) => {
      await tx.query(
        `INSERT INTO participant_speech_tone (meeting_id, participant_id, content_enc, model_version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (meeting_id, participant_id) DO UPDATE
           SET content_enc = EXCLUDED.content_enc, model_version = EXCLUDED.model_version`,
        [meetingId, participantId, contentEnc, modelVersion ?? null],
      );
      return meetingId;
    },
  );
}

export interface ParticipantSpeechTone {
  readonly meetingId: string;
  readonly participantId: string;
  readonly content: string;
  readonly createdAt: Date;
}

/** Leituras de tom já geradas para a reunião (todas os participantes). */
export async function listSpeechTone(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<ParticipantSpeechTone[]> {
  const res = await db.query<{ participant_id: string; content_enc: string; created_at: Date | string }>(
    'SELECT participant_id, content_enc, created_at FROM participant_speech_tone WHERE meeting_id = $1',
    [meetingId],
  );
  return res.rows.map((r) => ({
    meetingId,
    participantId: r.participant_id,
    content: decryptField(r.content_enc, encryptionKey),
    createdAt: new Date(r.created_at),
  }));
}

/** A leitura de tom de UM participante numa reunião específica (null se não existir/desligado). */
export async function loadSpeechTone(
  db: SqlExecutor,
  meetingId: string,
  participantId: string,
  encryptionKey: Buffer,
): Promise<string | null> {
  const res = await db.query<{ content_enc: string }>(
    'SELECT content_enc FROM participant_speech_tone WHERE meeting_id = $1 AND participant_id = $2',
    [meetingId, participantId],
  );
  const row = res.rows[0];
  return row ? decryptField(row.content_enc, encryptionKey) : null;
}
