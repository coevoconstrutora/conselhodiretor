import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { meetingAccessSql } from './access';

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
  /** Quem criou (meeting.user_id) — só ele gerencia confidencialidade/compartilhamento. */
  creatorId: string;
  creatorName: string;
  /** Confidencial: só criador, presentes com conta e convidados veem o conteúdo. */
  confidential: boolean;
  /** Tipo da reunião (vira "tag" na lista); null em reuniões antigas sem tipo. */
  meetingTypeId: string | null;
  meetingTypeName: string | null;
  /** Nomes dos participantes identificados que estiveram presentes. */
  attendees: string[];
  /** Quantas pessoas receberam acesso por compartilhamento. */
  sharedCount: number;
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

/** Pauta/roteiro opcional anexado na criação da reunião (Etapa "guia de reunião"). */
export interface MeetingGuidanceInput {
  readonly content: string;
  readonly filename: string;
}

/**
 * Abre uma reunião com gravação NÃO confirmada (default NEGA).
 * O título (e a pauta, se houver) são cifrados em repouso antes de tocar o banco.
 */
export async function createMeeting(
  db: SqlExecutor,
  userId: string,
  companyId: string,
  title: string,
  encryptionKey: Buffer,
  meetingTypeId?: string | null,
  guidance?: MeetingGuidanceInput | null,
  /**
   * Contexto ENTRE reuniões (Etapa "Histórico de reuniões") — referência
   * EXPLÍCITA a uma reunião anterior, só aplicada se ela realmente existir,
   * pertencer À MESMA empresa e estiver ENCERRADA (nunca confia no valor cru
   * do formulário — Seção 14 do pedido: nunca atribuir sozinho).
   */
  previousContextMeetingId?: string | null,
  /**
   * Link do Meet/Zoom/Teams anexado no AGENDAMENTO (Etapa "Campo de
   * agendamento") — só pré-preenche o painel do bot na sala; entrar numa
   * reunião já iniciada com um link diferente continua funcionando igual.
   */
  meetingUrl?: string | null,
  /** Confidencial desde a criação (só o criador, presentes com conta e convidados veem). */
  confidential = false,
): Promise<string> {
  const titleEnc = encryptField(title, encryptionKey);
  const guidanceEnc = guidance ? encryptField(guidance.content, encryptionKey) : null;
  const meetingUrlEnc = meetingUrl ? encryptField(meetingUrl, encryptionKey) : null;
  let validPreviousId: string | null = null;
  if (previousContextMeetingId) {
    const check = await db.query<{ id: string }>(
      // o contexto anterior entra no prompt da nova reunião: só de reunião que o criador PODE ver
      `SELECT m.id FROM meeting m WHERE m.id = $1 AND m.company_id = $2 AND m.status = 'closed'
         AND ${meetingAccessSql('m', '$3')}`,
      [previousContextMeetingId, companyId, userId],
    );
    validPreviousId = check.rows[0]?.id ?? null;
  }
  const res = await db.query<{ id: string }>(
    `INSERT INTO meeting (user_id, company_id, title_enc, meeting_type_id, guidance_enc, guidance_filename, previous_context_meeting_id, meeting_url_enc, confidential)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      userId,
      companyId,
      titleEnc,
      meetingTypeId ?? null,
      guidanceEnc,
      guidance?.filename ?? null,
      validPreviousId,
      meetingUrlEnc,
      confidential,
    ],
  );
  return res.rows[0]!.id;
}

/**
 * Pauta/roteiro anexado na criação da reunião — `null` se não houver, se a
 * reunião não pertencer à empresa, ou se a chave não decifrar (degrada
 * silenciosamente: pauta é só contexto extra, nunca crítica como o título).
 */
export async function getMeetingGuidance(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  encryptionKey: Buffer,
): Promise<MeetingGuidanceInput | null> {
  const res = await db.query<{ guidance_enc: string | null; guidance_filename: string | null }>(
    'SELECT guidance_enc, guidance_filename FROM meeting WHERE id = $1 AND company_id = $2',
    [meetingId, companyId],
  );
  const row = res.rows[0];
  if (!row?.guidance_enc) return null;
  try {
    return { content: decryptField(row.guidance_enc, encryptionKey), filename: row.guidance_filename ?? 'arquivo' };
  } catch {
    return null;
  }
}

/**
 * Link do Meet/Zoom/Teams anexado no agendamento — `null` se não houver, se
 * a reunião não pertencer à empresa, ou se a chave não decifrar (mesmo
 * degradê silencioso de `getMeetingGuidance`: é só um atalho de UI, nunca
 * crítico).
 */
export async function getMeetingUrl(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  encryptionKey: Buffer,
): Promise<string | null> {
  const res = await db.query<{ meeting_url_enc: string | null }>(
    'SELECT meeting_url_enc FROM meeting WHERE id = $1 AND company_id = $2',
    [meetingId, companyId],
  );
  const row = res.rows[0];
  if (!row?.meeting_url_enc) return null;
  try {
    return decryptField(row.meeting_url_enc, encryptionKey);
  } catch {
    return null;
  }
}

/**
 * Colunas do resumo (alias `m`) + criador, tipo, presentes e nº de convidados.
 * Presentes = participantes identificados (meeting_speaker.participant_id).
 */
const SUMMARY_SELECT = `
  SELECT m.id, m.title_enc, m.status, m.recording_confirmed, m.created_at, m.confirmed_at, m.closed_at,
         m.participant_count, m.user_id AS creator_id, u.display_name AS creator_name, m.confidential,
         m.meeting_type_id, mt.name AS meeting_type_name,
         COALESCE((SELECT array_agg(DISTINCT p.name ORDER BY p.name)
                   FROM meeting_speaker ms JOIN participant p ON p.id = ms.participant_id
                   WHERE ms.meeting_id = m.id), ARRAY[]::text[]) AS attendees,
         (SELECT count(*)::int FROM meeting_share s WHERE s.meeting_id = m.id) AS shared_count
  FROM meeting m
  JOIN app_user u ON u.id = m.user_id
  LEFT JOIN meeting_type mt ON mt.id = m.meeting_type_id`;

interface SummaryRow {
  id: string;
  title_enc: string;
  status: string;
  recording_confirmed: boolean;
  created_at: Date | string;
  confirmed_at: Date | string | null;
  closed_at: Date | string | null;
  participant_count: number | null;
  creator_id: string;
  creator_name: string;
  confidential: boolean;
  meeting_type_id: string | null;
  meeting_type_name: string | null;
  attendees: string[] | null;
  shared_count: number;
}

function toSummary(row: SummaryRow, encryptionKey: Buffer): MeetingSummary {
  return {
    id: row.id,
    title: safeDecrypt(row.title_enc, encryptionKey),
    status: row.status,
    recordingConfirmed: row.recording_confirmed,
    createdAt: new Date(row.created_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    participantCount: row.participant_count,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    confidential: row.confidential,
    meetingTypeId: row.meeting_type_id,
    meetingTypeName: row.meeting_type_name,
    attendees: row.attendees ?? [],
    sharedCount: Number(row.shared_count ?? 0),
  };
}

/**
 * Lista as reuniões DA EMPRESA que o usuário PODE VER (mais recente primeiro):
 * as abertas são da empresa toda; as confidenciais só aparecem para o criador,
 * presentes com conta e convidados. Empresas diferentes NUNCA veem as reuniões
 * umas das outras.
 */
export async function listMeetings(
  db: SqlExecutor,
  companyId: string,
  encryptionKey: Buffer,
  viewerUserId: string,
): Promise<MeetingSummary[]> {
  const res = await db.query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE m.company_id = $1 AND ${meetingAccessSql('m', '$2')}
     ORDER BY m.created_at DESC, m.id DESC`,
    [companyId, viewerUserId],
  );
  return res.rows.map((r) => toSummary(r, encryptionKey));
}

/** Carrega uma reunião DA EMPRESA que o usuário pode ver (null se não existe, é de outra empresa ou é confidencial sem acesso). */
export async function getMeeting(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  encryptionKey: Buffer,
  viewerUserId: string,
): Promise<MeetingSummary | null> {
  const res = await db.query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE m.id = $1 AND m.company_id = $2 AND ${meetingAccessSql('m', '$3')}`,
    [meetingId, companyId, viewerUserId],
  );
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
  /** Quem está agindo — exige acesso à reunião (confidencial). */
  viewerUserId?: string,
): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting m
       SET recording_confirmed = true, confirmed_at = now(), updated_at = now(),
           participant_count = COALESCE($3, m.participant_count)
     WHERE m.id = $1 AND m.company_id = $2 AND ($4::uuid IS NULL OR ${meetingAccessSql('m', '$4::uuid')})
     RETURNING m.id`,
    [meetingId, companyId, participantCount ?? null, viewerUserId ?? null],
  );
  assertAffected(res, meetingId);
}

/** Revoga a confirmação — a próxima checagem do gate passa a negar. */
export async function revokeRecording(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  viewerUserId?: string,
): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting m SET recording_confirmed = false, updated_at = now()
     WHERE m.id = $1 AND m.company_id = $2 AND ($3::uuid IS NULL OR ${meetingAccessSql('m', '$3::uuid')})
     RETURNING m.id`,
    [meetingId, companyId, viewerUserId ?? null],
  );
  assertAffected(res, meetingId);
}

/**
 * Encerra a reunião (marca status='closed') — combinado com `stopLiveBoard`
 * (board-runtime): para STT/board e trava novos "▶ Reunião simulada" ou
 * captura ao vivo. Transcrição e relatórios continuam disponíveis depois.
 * Idempotente: reencerrar só atualiza o carimbo.
 */
export async function closeMeeting(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  viewerUserId?: string,
): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting m SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE m.id = $1 AND m.company_id = $2 AND ($3::uuid IS NULL OR ${meetingAccessSql('m', '$3::uuid')})
     RETURNING m.id`,
    [meetingId, companyId, viewerUserId ?? null],
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
 * Escopado à EMPRESA chamadora: reunião de outra empresa (ou inexistente)
 * ou confirmação revogada ⇒ false. Nunca confia no cliente.
 */
export async function isRecordingConfirmed(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
): Promise<boolean> {
  const res = await db.query<{ recording_confirmed: boolean }>(
    'SELECT recording_confirmed FROM meeting WHERE id = $1 AND company_id = $2',
    [meetingId, companyId],
  );
  return res.rows[0]?.recording_confirmed === true;
}

/**
 * Versão imperativa do gate para os pontos de entrada de captura: lança
 * {@link RecordingRequiredError} se a gravação não estiver confirmada
 * (ou a reunião não pertencer à empresa chamadora).
 */
export async function assertRecordingConfirmed(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
): Promise<void> {
  if (!(await isRecordingConfirmed(db, meetingId, companyId))) {
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
