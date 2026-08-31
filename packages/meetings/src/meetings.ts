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
  title: string,
  encryptionKey: Buffer,
): Promise<string> {
  const titleEnc = encryptField(title, encryptionKey);
  const res = await db.query<{ id: string }>(
    'INSERT INTO meeting (user_id, title_enc) VALUES ($1, $2) RETURNING id',
    [userId, titleEnc],
  );
  return res.rows[0]!.id;
}

/**
 * Lista as reuniões da EMPRESA (compartilhadas entre todos os usuários — o
 * conselho é colaborativo, não uma agenda individual), mais recente primeiro.
 * `userId` fica no parâmetro por compatibilidade de assinatura, mas não filtra
 * mais — só `createMeeting` usa o user_id, como proveniência de quem criou.
 */
export async function listMeetings(
  db: SqlExecutor,
  _userId: string,
  encryptionKey: Buffer,
): Promise<MeetingSummary[]> {
  const res = await db.query<
    Pick<MeetingRow, 'id' | 'title_enc' | 'status' | 'recording_confirmed' | 'created_at'>
  >(`SELECT id, title_enc, status, recording_confirmed, created_at FROM meeting ORDER BY created_at DESC, id DESC`);
  return res.rows.map((r) => ({
    id: r.id,
    title: safeDecrypt(r.title_enc, encryptionKey),
    status: r.status,
    recordingConfirmed: r.recording_confirmed,
    createdAt: new Date(r.created_at),
  }));
}

/** Carrega uma reunião da empresa (null se não existe) — compartilhada entre usuários. */
export async function getMeeting(
  db: SqlExecutor,
  meetingId: string,
  _userId: string,
  encryptionKey: Buffer,
): Promise<MeetingSummary | null> {
  const res = await db.query<
    Pick<MeetingRow, 'id' | 'title_enc' | 'status' | 'recording_confirmed' | 'created_at'>
  >(`SELECT id, title_enc, status, recording_confirmed, created_at FROM meeting WHERE id = $1`, [
    meetingId,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: safeDecrypt(row.title_enc, encryptionKey),
    status: row.status,
    recordingConfirmed: row.recording_confirmed,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Confirma a gravação (participantes cientes e de acordo). Idempotente:
 * reconfirmar apenas atualiza o carimbo. Falha se a reunião não existe.
 */
export async function confirmRecording(db: SqlExecutor, meetingId: string): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting
       SET recording_confirmed = true, confirmed_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [meetingId],
  );
  assertAffected(res, meetingId);
}

/** Revoga a confirmação — a próxima checagem do gate passa a negar. */
export async function revokeRecording(db: SqlExecutor, meetingId: string): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting SET recording_confirmed = false, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [meetingId],
  );
  assertAffected(res, meetingId);
}

/**
 * Encerra a reunião (marca status='closed') — combinado com `stopLiveBoard`
 * (board-runtime): para STT/board e trava novos "▶ Reunião simulada" ou
 * captura ao vivo. Transcrição e relatórios continuam disponíveis depois.
 * Idempotente: reencerrar só atualiza o carimbo.
 */
export async function closeMeeting(db: SqlExecutor, meetingId: string): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting SET status = 'closed', updated_at = now() WHERE id = $1 RETURNING id`,
    [meetingId],
  );
  assertAffected(res, meetingId);
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
