import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { decryptField } from '@conselho/crypto';
import type { KnownSpeaker } from './speaker-names';
import { touchParticipantLastMeeting } from './participants';
import { getEncryptionKey } from './crypto-key';
import type { ParticipantSignal } from './participant-signals';

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
 * Analytics OBJETIVAS (Seção 21) — só contagem de intervenções e fatia da
 * reunião, nunca estado emocional. Proxy honesto: conta segmentos finais que
 * começam com o rótulo daquele locutor (nome resolvido ou "Locutor N" antes
 * da autoapresentação) — não há medição de tempo de fala real disponível
 * nesta etapa (ver nota no relatório final).
 */
export async function computeParticipantMeetingAnalytics(
  db: SqlExecutor,
  meetingId: string,
  finals: readonly string[],
  knownSpeakers: readonly KnownSpeaker[],
): Promise<void> {
  if (knownSpeakers.length === 0 || finals.length === 0) return;
  const res = await db.query<{ speaker_label: string; participant_id: string | null }>(
    `SELECT speaker_label, participant_id FROM meeting_speaker WHERE meeting_id = $1 AND participant_id IS NOT NULL`,
    [meetingId],
  );
  const byParticipant = new Map<string, number>();
  for (const row of res.rows) {
    if (!row.participant_id) continue;
    const speakerNum = row.speaker_label.replace(/^Locutor /, '');
    const known = knownSpeakers.find((s) => s.speakerNum === speakerNum);
    const prefixes = [`Locutor ${speakerNum}: `, known ? `${known.name}: ` : null].filter(
      (p): p is string => p !== null,
    );
    const turns = finals.filter((f) => prefixes.some((p) => f.startsWith(p))).length;
    if (turns > 0) byParticipant.set(row.participant_id, turns);
  }
  const totalTurns = [...byParticipant.values()].reduce((a, b) => a + b, 0);
  if (totalTurns === 0) return;
  for (const [participantId, turns] of byParticipant) {
    await db.query(
      `INSERT INTO participant_meeting_analytics (meeting_id, participant_id, speaking_turns, speech_share)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (meeting_id, participant_id) DO UPDATE
         SET speaking_turns = EXCLUDED.speaking_turns, speech_share = EXCLUDED.speech_share`,
      [meetingId, participantId, turns, turns / totalTurns],
    );
  }
}

/**
 * Sinais OBJETIVOS de participação desta reunião (Seção 25) — para o
 * Presidente usar como PISTA de contexto na síntese final, nunca para rotular
 * estado emocional (instrução equivalente no prompt de `presidentSystem`).
 */
export async function listMeetingParticipantSignals(db: SqlExecutor, meetingId: string): Promise<ParticipantSignal[]> {
  const res = await db.query<{ name: string; speaking_turns: number; speech_share: number | null }>(
    `SELECT p.name, a.speaking_turns, a.speech_share
     FROM participant_meeting_analytics a
     JOIN participant p ON p.id = a.participant_id
     WHERE a.meeting_id = $1
     ORDER BY a.speaking_turns DESC`,
    [meetingId],
  );
  return res.rows.map((r) => ({ name: r.name, speakingTurns: r.speaking_turns, speechShare: r.speech_share }));
}

export interface ParticipantMeetingHistoryEntry {
  readonly meetingId: string;
  readonly meetingTitle: string;
  readonly closedAt: Date | null;
  readonly speakingTurns: number | null;
  readonly speechShare: number | null;
  readonly identificationStatus: string;
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
  }>(
    `SELECT m.id AS meeting_id, m.title_enc, m.updated_at, ms.identification_status,
            a.speaking_turns, a.speech_share
     FROM meeting_speaker ms
     JOIN meeting m ON m.id = ms.meeting_id AND m.company_id = $1
     LEFT JOIN participant_meeting_analytics a ON a.meeting_id = ms.meeting_id AND a.participant_id = ms.participant_id
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
    return {
      meetingId: r.meeting_id,
      meetingTitle: title,
      closedAt: r.updated_at ? new Date(r.updated_at) : null,
      speakingTurns: r.speaking_turns,
      speechShare: r.speech_share,
      identificationStatus: r.identification_status,
    };
  });
}
