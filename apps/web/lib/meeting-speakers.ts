import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { decryptField } from '@conselho/crypto';
import type { TimedTranscriptSegment } from '@conselho/meeting-report';
import type { KnownSpeaker } from './speaker-names';
import { touchParticipantLastMeeting } from './participants';
import { getEncryptionKey } from './crypto-key';
import type { ParticipantSignal } from './participant-signals';

/**
 * Gap (ms) abaixo do qual uma troca de locutor conta como "troca abrupta de
 * turno" (proxy de interrupção) — Etapa "Análise de fala dos presentes". A
 * gravação é um único stream de áudio misto (não 1 mic por pessoa): overlap
 * REAL de áudio quase nunca aparece como timestamps sobrepostos no Deepgram,
 * então isto é uma aproximação por proximidade temporal, nunca uma detecção
 * de sobreposição de fato — documentado assim de propósito na UI também.
 */
const INTERRUPTION_GAP_MS = 300;

export { formatParticipantSignalsBlock } from './participant-signals';
export type { ParticipantSignal } from './participant-signals';

/**
 * Elo locutor→participante POR REUNIÃO (Seção 16) — a diarização do Deepgram
 * só devolve "Locutor N" anônimo; isto é o que dá identidade real a ele.
 *
 * Nesta entrega, o vínculo AUTOMÁTICO usa a autoapresentação já existente
 * (Tier 2, `speaker-names.ts`) cruzada com o cadastro de Participantes —
 * texto, não biometria (comparação de áudio ao vivo fica para uma etapa
 * futura dedicada — ver nota no relatório final). Confirmação manual
 * (Seção 18) fica pronta no schema (`confirmed_by_user_id`/`confirmed_at`)
 * para quando a UI de confirmação for construída.
 */

/** Casa o nome autoapresentado com um Participant ativo da empresa (case-insensitive). */
export async function reconcileMeetingSpeakers(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  knownSpeakers: readonly KnownSpeaker[],
): Promise<void> {
  if (knownSpeakers.length === 0) return;
  const matchedParticipantIds: string[] = [];
  for (const speaker of knownSpeakers) {
    const res = await db.query<{ id: string }>(
      `SELECT id FROM participant WHERE company_id = $1 AND status = 'active' AND lower(name) = lower($2) LIMIT 1`,
      [companyId, speaker.name],
    );
    const participantId = res.rows[0]?.id ?? null;
    await db.query(
      `INSERT INTO meeting_speaker
         (meeting_id, speaker_label, participant_id, identification_status, identification_source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (meeting_id, speaker_label) DO UPDATE
         SET participant_id = EXCLUDED.participant_id,
             identification_status = EXCLUDED.identification_status,
             identification_source = EXCLUDED.identification_source,
             updated_at = now()`,
      [
        meetingId,
        `Locutor ${speaker.speakerNum}`,
        participantId,
        participantId ? 'identified' : 'unknown',
        participantId ? 'self_introduction' : null,
      ],
    );
    if (participantId) matchedParticipantIds.push(participantId);
  }
  await touchParticipantLastMeeting(db, matchedParticipantIds);
}

/**
 * Linka um "Locutor N" a um Participant por RECONHECIMENTO DE VOZ ao vivo
 * (Etapa "Reconhecimento de voz ao vivo") — complementa `reconcileMeetingSpeakers`
 * (que só liga por autoapresentação em TEXTO). O clipe em si nunca é
 * persistido: o cliente grava alguns segundos, manda pro embedding e
 * descarta — só o resultado da comparação chega aqui.
 *
 * Nunca REBAIXA uma identificação já 'identified' (self-introduction ou
 * confirmação manual) para um match de voz mais fraco — só complementa
 * locutores ainda 'unknown'/'probable'.
 */
export async function linkSpeakerByVoice(
  db: SqlExecutor,
  meetingId: string,
  speakerNum: string,
  participantId: string,
  band: 'identified' | 'probable',
): Promise<void> {
  await db.query(
    `INSERT INTO meeting_speaker
       (meeting_id, speaker_label, participant_id, identification_status, identification_source)
     VALUES ($1, $2, $3, $4, 'voice_biometric')
     ON CONFLICT (meeting_id, speaker_label) DO UPDATE
       SET participant_id = EXCLUDED.participant_id,
           identification_status = EXCLUDED.identification_status,
           identification_source = EXCLUDED.identification_source,
           updated_at = now()
       WHERE meeting_speaker.identification_status IS DISTINCT FROM 'identified'`,
    [meetingId, `Locutor ${speakerNum}`, participantId, band],
  );
  await touchParticipantLastMeeting(db, [participantId]);
}

/**
 * Analytics OBJETIVAS (Seção 21) — intervenções, fatia da reunião, tempo real
 * de fala e trocas abruptas de turno; NUNCA estado emocional/psicológico.
 * Proxy honesto de identidade: resolve o locutor pelo prefixo do segmento
 * (nome resolvido ou "Locutor N" antes da autoapresentação) — mesmo esquema
 * de sempre, agora numa única passada pelos segmentos (em vez de 1
 * filter/segmento) que também soma a duração real (`endMs - startMs`, ver
 * `TimedTranscriptSegment`) e detecta trocas de locutor a menos de
 * `INTERRUPTION_GAP_MS` do fim do segmento anterior (proxy de interrupção —
 * ver nota acima sobre a limitação de stream único).
 */
export async function computeParticipantMeetingAnalytics(
  db: SqlExecutor,
  meetingId: string,
  segments: readonly TimedTranscriptSegment[],
  knownSpeakers: readonly KnownSpeaker[],
): Promise<void> {
  if (knownSpeakers.length === 0 || segments.length === 0) return;
  const res = await db.query<{ speaker_label: string; participant_id: string | null }>(
    `SELECT speaker_label, participant_id FROM meeting_speaker WHERE meeting_id = $1 AND participant_id IS NOT NULL`,
    [meetingId],
  );
  const participantBySpeakerNum = new Map<string, string>();
  const prefixesBySpeakerNum = new Map<string, string[]>();
  for (const row of res.rows) {
    if (!row.participant_id) continue;
    const speakerNum = row.speaker_label.replace(/^Locutor /, '');
    participantBySpeakerNum.set(speakerNum, row.participant_id);
    const known = knownSpeakers.find((s) => s.speakerNum === speakerNum);
    prefixesBySpeakerNum.set(
      speakerNum,
      [`Locutor ${speakerNum}: `, known ? `${known.name}: ` : null].filter((p): p is string => p !== null),
    );
  }
  if (participantBySpeakerNum.size === 0) return;

  const resolveParticipantId = (text: string): string | null => {
    for (const [speakerNum, prefixes] of prefixesBySpeakerNum) {
      if (prefixes.some((p) => text.startsWith(p))) return participantBySpeakerNum.get(speakerNum) ?? null;
    }
    return null;
  };

  const turnsByParticipant = new Map<string, number>();
  const msByParticipant = new Map<string, number>();
  const interruptionsByParticipant = new Map<string, number>();
  let prevParticipantId: string | null = null;
  let prevEndMs: number | null = null;

  for (const seg of segments) {
    const participantId = resolveParticipantId(seg.text);
    if (!participantId) {
      prevParticipantId = null;
      prevEndMs = null;
      continue;
    }
    turnsByParticipant.set(participantId, (turnsByParticipant.get(participantId) ?? 0) + 1);
    if (seg.startMs !== null && seg.endMs !== null) {
      msByParticipant.set(participantId, (msByParticipant.get(participantId) ?? 0) + Math.max(0, seg.endMs - seg.startMs));
      if (
        prevParticipantId &&
        prevParticipantId !== participantId &&
        prevEndMs !== null &&
        seg.startMs <= prevEndMs + INTERRUPTION_GAP_MS
      ) {
        interruptionsByParticipant.set(participantId, (interruptionsByParticipant.get(participantId) ?? 0) + 1);
      }
      prevEndMs = seg.endMs;
    } else {
      prevEndMs = null; // sem timing — não dá pra avaliar a próxima troca com segurança
    }
    prevParticipantId = participantId;
  }

  const totalTurns = [...turnsByParticipant.values()].reduce((a, b) => a + b, 0);
  if (totalTurns === 0) return;
  for (const [participantId, turns] of turnsByParticipant) {
    const speakingMs = msByParticipant.get(participantId) ?? 0;
    const interruptionCount = interruptionsByParticipant.get(participantId) ?? 0;
    await db.query(
      `INSERT INTO participant_meeting_analytics
         (meeting_id, participant_id, speaking_turns, speech_share, speaking_ms, interruption_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (meeting_id, participant_id) DO UPDATE
         SET speaking_turns = EXCLUDED.speaking_turns, speech_share = EXCLUDED.speech_share,
             speaking_ms = EXCLUDED.speaking_ms, interruption_count = EXCLUDED.interruption_count`,
      [meetingId, participantId, turns, turns / totalTurns, speakingMs, interruptionCount],
    );
  }
}

/**
 * Sinais OBJETIVOS de participação desta reunião (Seção 25) — para o
 * Presidente usar como PISTA de contexto na síntese final, nunca para rotular
 * estado emocional (instrução equivalente no prompt de `presidentSystem`).
 */
export async function listMeetingParticipantSignals(db: SqlExecutor, meetingId: string): Promise<ParticipantSignal[]> {
  const res = await db.query<{
    name: string;
    speaking_turns: number;
    speech_share: number | null;
    speaking_ms: number;
    interruption_count: number;
  }>(
    `SELECT p.name, a.speaking_turns, a.speech_share, a.speaking_ms, a.interruption_count
     FROM participant_meeting_analytics a
     JOIN participant p ON p.id = a.participant_id
     WHERE a.meeting_id = $1
     ORDER BY a.speaking_turns DESC`,
    [meetingId],
  );
  return res.rows.map((r) => ({
    name: r.name,
    speakingTurns: r.speaking_turns,
    speechShare: r.speech_share,
    speakingMs: r.speaking_ms,
    interruptionCount: r.interruption_count,
  }));
}

export interface ParticipantMeetingHistoryEntry {
  readonly meetingId: string;
  readonly meetingTitle: string;
  readonly closedAt: Date | null;
  readonly speakingTurns: number | null;
  readonly speechShare: number | null;
  /** Tempo real de fala em ms — null quando a reunião é anterior ao timing (migration 0029). */
  readonly speakingMs: number | null;
  /** Trocas abruptas de turno (proxy de interrupção — ver nota em `INTERRUPTION_GAP_MS`). */
  readonly interruptionCount: number | null;
  readonly identificationStatus: string;
  /** Leitura de tom (opt-in, Etapa "Análise de fala dos presentes") — null se desligado/não gerado. */
  readonly speechTone: string | null;
}

/** Histórico de reuniões de um participante (Seção 20) — sem detalhe biométrico bruto. */
export async function listParticipantMeetingHistory(
  db: SqlExecutor,
  companyId: string,
  participantId: string,
): Promise<ParticipantMeetingHistoryEntry[]> {
  const res = await db.query<{
    meeting_id: string;
    title_enc: string;
    updated_at: Date | string;
    identification_status: string;
    speaking_turns: number | null;
    speech_share: number | null;
    speaking_ms: number | null;
    interruption_count: number | null;
    speech_tone_enc: string | null;
  }>(
    `SELECT m.id AS meeting_id, m.title_enc, m.updated_at, ms.identification_status,
            a.speaking_turns, a.speech_share, a.speaking_ms, a.interruption_count, st.content_enc AS speech_tone_enc
     FROM meeting_speaker ms
     JOIN meeting m ON m.id = ms.meeting_id AND m.company_id = $1
     LEFT JOIN participant_meeting_analytics a ON a.meeting_id = ms.meeting_id AND a.participant_id = ms.participant_id
     LEFT JOIN participant_speech_tone st ON st.meeting_id = ms.meeting_id AND st.participant_id = ms.participant_id
     WHERE ms.participant_id = $2
     ORDER BY m.updated_at DESC`,
    [companyId, participantId],
  );
  const key = getEncryptionKey();
  return res.rows.map((r) => {
    let title = 'Reunião';
    try {
      title = decryptField(r.title_enc, key);
    } catch {
      title = 'Reunião (título ilegível)';
    }
    let speechTone: string | null = null;
    if (r.speech_tone_enc) {
      try {
        speechTone = decryptField(r.speech_tone_enc, key);
      } catch {
        speechTone = null;
      }
    }
    return {
      meetingId: r.meeting_id,
      meetingTitle: title,
      closedAt: r.updated_at ? new Date(r.updated_at) : null,
      speechTone,
      speakingTurns: r.speaking_turns,
      speechShare: r.speech_share,
      speakingMs: r.speaking_ms,
      interruptionCount: r.interruption_count,
      identificationStatus: r.identification_status,
    };
  });
}

export interface ParticipantUtterances {
  readonly participantId: string;
  readonly participantName: string;
  readonly utterances: readonly string[];
}

/**
 * Agrupa os segmentos finais da reunião por participante IDENTIFICADO (Etapa
 * "Análise de fala dos presentes" — usado hoje só pela análise de tom
 * opt-in, `speech-tone.ts`). Resolve o mesmo jeito de sempre: prefixo
 * "Locutor N: " OU o nome do participante (`reconcileMeetingSpeakers` só
 * vincula quando o nome autoapresentado bate, então o nome registrado É o
 * prefixo usado no texto a partir da autoapresentação) — sem depender do
 * tracker ao vivo (que pode já ter saído de memória quando os relatórios
 * são gerados bem depois do encerramento).
 */
export async function groupTranscriptByParticipant(
  db: SqlExecutor,
  meetingId: string,
  texts: readonly string[],
): Promise<ParticipantUtterances[]> {
  if (texts.length === 0) return [];
  const res = await db.query<{ speaker_label: string; participant_id: string; name: string }>(
    `SELECT ms.speaker_label, ms.participant_id, p.name
     FROM meeting_speaker ms
     JOIN participant p ON p.id = ms.participant_id
     WHERE ms.meeting_id = $1 AND ms.participant_id IS NOT NULL`,
    [meetingId],
  );
  if (res.rows.length === 0) return [];

  const byParticipant = new Map<string, { name: string; utterances: string[] }>();
  const prefixed = res.rows.map((row) => {
    const speakerNum = row.speaker_label.replace(/^Locutor /, '');
    return {
      participantId: row.participant_id,
      name: row.name,
      prefixes: [`Locutor ${speakerNum}: `, `${row.name}: `],
    };
  });

  for (const text of texts) {
    for (const p of prefixed) {
      const match = p.prefixes.find((prefix) => text.startsWith(prefix));
      if (!match) continue;
      const entry = byParticipant.get(p.participantId) ?? { name: p.name, utterances: [] };
      entry.utterances.push(text.slice(match.length));
      byParticipant.set(p.participantId, entry);
      break;
    }
  }

  return [...byParticipant.entries()].map(([participantId, { name, utterances }]) => ({
    participantId,
    participantName: name,
    utterances,
  }));
}
