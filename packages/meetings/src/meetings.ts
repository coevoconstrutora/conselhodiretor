import type { SqlExecutor, MeetingRow } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';

/**
 * Meeting Service — ciclo de vida da reunião + GATE de gravação no servidor.
 *
 * O servidor é a ÚNICA fonte de verdade sobre se a captura de áudio pode
 * ocorrer: nenhum caminho de captura liga sem antes passar por
 * {@link assertRecordingConfirmed}. O cliente nunca decide — apenas reflete o
 * veredito do servidor. Toda reunião nasce com `recording_confirmed = false`
 * (default NEGA): o empresário confirma que os participantes autorizaram a
 * gravação antes de qualquer áudio ser capturado.
 */

export interface MeetingSummary {
  id: string;
  title: string;
  status: string;
  recordingConfirmed: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
  closedAt: Date | null;
  participantCount: number | null;
}

/** Lançado quando uma captura é tentada sem a confirmação de gravação. */
export class RecordingRequiredError extends Error {
  readonly meetingId: string;
  constructor(meetingId: string) {
    super(
      `Captura bloqueada: gravação não confirmada pelos participantes (reunião ${meetingId}).`,
    );
    this.name = 'RecordingRequiredError';
    this.meetingId = meetingId;
  }
}

/**
 * Abre uma reunião com gravação NÃO confirmada (default NEGA).
 * O título é cifrado em repouso antes de tocar o banco.
 */
export async function createMeeting(
  db: SqlExecutor,
  userId: string,
  companyId: string,
  title: string,
  encryptionKey: Buffer,
): Promise<string> {
  const titleEnc = encryptField(title, encryptionKey);
  const res = await db.query<{ id: string }>(
    'INSERT INTO meeting (user_id, company_id, title_enc) VALUES ($1, $2, $3) RETURNING id',
    [userId, companyId, titleEnc],
  );
  return res.rows[0]!.id;
}

/**
 * Lista as reuniões DA EMPRESA (compartilhadas entre os usuários dela — o
 * conselho é colaborativo, não uma agenda individual; empresas diferentes
 * NUNCA veem as reuniões umas das outras), mais recente primeiro.
 */
const SUMMARY_COLUMNS =
  'id, title_enc, status, recording_confirmed, created_at, confirmed_at, closed_at, participant_count';

function toSummary(
  row: Pick<
    MeetingRow,
    'id' | 'title_enc' | 'status' | 'recording_confirmed' | 'created_at' | 'confirmed_at' | 'closed_at' | 'participant_count'
  >,
  encryptionKey: Buffer,
): MeetingSummary {
  return {
    id: row.id,
    title: safeDecrypt(row.title_enc, encryptionKey),
    status: row.status,
    recordingConfirmed: row.recording_confirmed,
    createdAt: new Date(row.created_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    participantCount: row.participant_count,
  };
}

export async function listMeetings(
  db: SqlExecutor,
  companyId: string,
  encryptionKey: Buffer,
): Promise<MeetingSummary[]> {
  const res = await db.query<
    Pick<MeetingRow, 'id' | 'title_enc' | 'status' | 'recording_confirmed' | 'created_at' | 'confirmed_at' | 'closed_at' | 'participant_count'>
  >(`SELECT ${SUMMARY_COLUMNS} FROM meeting WHERE company_id = $1 ORDER BY created_at DESC, id DESC`, [
    companyId,
  ]);
  return res.rows.map((r) => toSummary(r, encryptionKey));
}

/** Carrega uma reunião DA EMPRESA (null se não existe OU pertence a outra empresa). */
export async function getMeeting(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  encryptionKey: Buffer,
): Promise<MeetingSummary | null> {
  const res = await db.query<
    Pick<MeetingRow, 'id' | 'title_enc' | 'status' | 'recording_confirmed' | 'created_at' | 'confirmed_at' | 'closed_at' | 'participant_count'>
  >(`SELECT ${SUMMARY_COLUMNS} FROM meeting WHERE id = $1 AND company_id = $2`, [meetingId, companyId]);
  const row = res.rows[0];
  return row ? toSummary(row, encryptionKey) : null;
}

/**
 * Confirma a gravação (participantes cientes e de acordo) + nº de presentes
 * (exibido no resumo pós-reunião). Idempotente: reconfirmar só atualiza o
 * carimbo. Falha se a reunião não existe.
 */
export async function confirmRecording(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  participantCount?: number,
): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting
       SET recording_confirmed = true, confirmed_at = now(), updated_at = now(),
           participant_count = COALESCE($3, participant_count)
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [meetingId, companyId, participantCount ?? null],
  );
  assertAffected(res, meetingId);
}

/** Revoga a confirmação — a próxima checagem do gate passa a negar. */
export async function revokeRecording(db: SqlExecutor, meetingId: string, companyId: string): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting SET recording_confirmed = false, updated_at = now()
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [meetingId, companyId],
  );
  assertAffected(res, meetingId);
}

/**
 * Encerra a reunião (marca status='closed') — combinado com `stopLiveBoard`
 * (board-runtime): para STT/board e trava novos "▶ Reunião simulada" ou
 * captura ao vivo. Transcrição e relatórios continuam disponíveis depois.
 * Idempotente: reencerrar só atualiza o carimbo.
 */
export async function closeMeeting(db: SqlExecutor, meetingId: string, companyId: string): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE id = $1 AND company_id = $2 RETURNING id`,
    [meetingId, companyId],
  );
  assertAffected(res, meetingId);
}

/** Checagem leve (sem decifrar) — usada por actions que só recebem o meetingId do form. */
export async function meetingBelongsToCompany(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    'SELECT id FROM meeting WHERE id = $1 AND company_id = $2',
    [meetingId, companyId],
  );
  return res.rows.length > 0;
}

/**
 * GATE DE SERVIDOR — fonte de verdade da autorização de captura.
 * Ausência de reunião ou confirmação revogada ⇒ false. Nunca confia no cliente.
 */
export async function isRecordingConfirmed(db: SqlExecutor, meetingId: string): Promise<boolean> {
  const res = await db.query<{ recording_confirmed: boolean }>(
    'SELECT recording_confirmed FROM meeting WHERE id = $1',
    [meetingId],
  );
  return res.rows[0]?.recording_confirmed === true;
}

/**
 * Versão imperativa do gate para os pontos de entrada de captura: lança
 * {@link RecordingRequiredError} se a gravação não estiver confirmada.
 */
export async function assertRecordingConfirmed(
  db: SqlExecutor,
  meetingId: string,
): Promise<void> {
  if (!(await isRecordingConfirmed(db, meetingId))) {
    throw new RecordingRequiredError(meetingId);
  }
}

/** Decifra com tolerância: chave trocada/dado corrompido não derruba a listagem. */
function safeDecrypt(payload: string, key: Buffer): string {
  try {
    return decryptField(payload, key);
  } catch {
    return '(título indisponível)';
  }
}

function assertAffected(res: { rows: unknown[] }, meetingId: string): void {
  if (res.rows.length === 0) {
    throw new Error(`Reunião ${meetingId} não encontrada.`);
  }
}
