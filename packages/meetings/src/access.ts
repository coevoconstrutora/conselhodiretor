import type { SqlExecutor } from '@conselho/db';

/**
 * Acesso por reunião. Regra:
 * - reunião NÃO confidencial: toda a empresa vê (como sempre foi);
 * - reunião confidencial: só quem criou, quem esteve presente E tem conta
 *   vinculada ao participante identificado, e quem foi convidado
 *   (`meeting_share`). Admin/gestor da empresa NÃO têm acesso especial — é o
 *   ponto da confidencialidade.
 * Só o CRIADOR marca/desmarca confidencial e gerencia o compartilhamento.
 */

/**
 * Fragmento SQL "o usuário do parâmetro `$userParam` pode ver a reunião `alias`".
 * Único ponto de verdade — usado por listagem, gate das actions, gateway WS e
 * agregados entre reuniões (histórico/melhorias/experimentos).
 */
export function meetingAccessSql(alias: string, userParam: string): string {
  const u = userParam;
  const m = alias;
  return (
    `(${m}.confidential = false OR ${m}.user_id = ${u} ` +
    `OR EXISTS (SELECT 1 FROM meeting_share s WHERE s.meeting_id = ${m}.id AND s.user_id = ${u}) ` +
    `OR EXISTS (SELECT 1 FROM meeting_speaker msp JOIN participant pp ON pp.id = msp.participant_id ` +
    `WHERE msp.meeting_id = ${m}.id AND pp.app_user_id = ${u}))`
  );
}

/**
 * Variante para AGREGADOS entre reuniões (histórico, melhorias, experimentos):
 * `$userParam` pode ser NULL (uso sistêmico, sem usuário) — aí só entram as
 * reuniões NÃO confidenciais. Conteúdo confidencial nunca vaza para telas ou
 * prompts que misturam várias reuniões.
 */
export function meetingVisibleSql(alias: string, userParam: string): string {
  return (
    `((${userParam}::uuid IS NULL AND ${alias}.confidential = false) OR ` +
    `(${userParam}::uuid IS NOT NULL AND ${meetingAccessSql(alias, `${userParam}::uuid`)}))`
  );
}

/** A reunião é DA empresa do usuário e ele tem acesso a ela (confidencial incluída). */
export async function canAccessMeeting(
  db: SqlExecutor,
  meetingId: string,
  viewer: { userId: string; companyId: string },
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    `SELECT m.id FROM meeting m WHERE m.id = $1 AND m.company_id = $2 AND ${meetingAccessSql('m', '$3')}`,
    [meetingId, viewer.companyId, viewer.userId],
  );
  return res.rows.length > 0;
}

export interface MeetingShareEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly sharedAt: Date;
}

/** Só o criador altera a confidencialidade. */
export async function setMeetingConfidential(
  db: SqlExecutor,
  meetingId: string,
  ownerUserId: string,
  companyId: string,
  confidential: boolean,
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    `UPDATE meeting SET confidential = $4, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id`,
    [meetingId, ownerUserId, companyId, confidential],
  );
  return res.rows.length > 0;
}

export type ShareResult = 'ok' | 'not_owner' | 'not_member' | 'self';

/** Compartilha com um usuário da MESMA empresa (membro) — só o criador. Idempotente. */
export async function shareMeeting(
  db: SqlExecutor,
  meetingId: string,
  ownerUserId: string,
  companyId: string,
  targetUserId: string,
): Promise<ShareResult> {
  const owner = await db.query<{ id: string }>(
    'SELECT id FROM meeting WHERE id = $1 AND user_id = $2 AND company_id = $3',
    [meetingId, ownerUserId, companyId],
  );
  if (owner.rows.length === 0) return 'not_owner';
  if (targetUserId === ownerUserId) return 'self';
  const member = await db.query<{ id: string }>(
    'SELECT id FROM company_member WHERE user_id = $1 AND company_id = $2',
    [targetUserId, companyId],
  );
  if (member.rows.length === 0) return 'not_member';
  await db.query(
    `INSERT INTO meeting_share (meeting_id, user_id, shared_by) VALUES ($1, $2, $3)
     ON CONFLICT (meeting_id, user_id) DO NOTHING`,
    [meetingId, targetUserId, ownerUserId],
  );
  return 'ok';
}

export async function unshareMeeting(
  db: SqlExecutor,
  meetingId: string,
  ownerUserId: string,
  companyId: string,
  targetUserId: string,
): Promise<boolean> {
  const owner = await db.query<{ id: string }>(
    'SELECT id FROM meeting WHERE id = $1 AND user_id = $2 AND company_id = $3',
    [meetingId, ownerUserId, companyId],
  );
  if (owner.rows.length === 0) return false;
  await db.query('DELETE FROM meeting_share WHERE meeting_id = $1 AND user_id = $2', [meetingId, targetUserId]);
  return true;
}

export async function listMeetingShares(db: SqlExecutor, meetingId: string): Promise<MeetingShareEntry[]> {
  const res = await db.query<{ user_id: string; display_name: string; email: string; created_at: Date | string }>(
    `SELECT s.user_id, u.display_name, u.email, s.created_at
     FROM meeting_share s JOIN app_user u ON u.id = s.user_id
     WHERE s.meeting_id = $1 ORDER BY s.created_at ASC`,
    [meetingId],
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    sharedAt: new Date(r.created_at),
  }));
}
