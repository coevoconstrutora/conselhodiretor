import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { auditedClinicalWrite } from '@conselho/audit';

/**
 * Participantes REAIS de reunião (Etapa "Participantes"): distintos de
 * `app_user` (login do sistema) — uma pessoa participa de reuniões sem
 * NUNCA precisar de conta, e um `app_user` pode opcionalmente referenciar
 * seu Participant (`appUserId`). Multi-tenant: tudo escopado por
 * `companyId`, mesmo padrão do resto do produto.
 */

export type ParticipantStatus = 'active' | 'inactive';

export interface Participant {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string | null;
  readonly jobTitle: string | null;
  readonly department: string | null;
  readonly companyName: string | null;
  readonly appUserId: string | null;
  readonly appUserEmail: string | null;
  readonly status: ParticipantStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastMeetingAt: Date | null;
}

export interface ParticipantFilters {
  readonly q?: string;
  readonly status?: ParticipantStatus;
  readonly department?: string;
}

const NAME_MAX = 160;
const TEXT_FIELD_MAX = 160;

export interface ParticipantInput {
  readonly name: string;
  readonly email?: string | null;
  readonly jobTitle?: string | null;
  readonly department?: string | null;
  readonly companyName?: string | null;
}

function normalize(input: ParticipantInput): {
  name: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  companyName: string | null;
} {
  return {
    name: input.name.trim().slice(0, NAME_MAX),
    email: input.email?.trim().slice(0, TEXT_FIELD_MAX) || null,
    jobTitle: input.jobTitle?.trim().slice(0, TEXT_FIELD_MAX) || null,
    department: input.department?.trim().slice(0, TEXT_FIELD_MAX) || null,
    companyName: input.companyName?.trim().slice(0, TEXT_FIELD_MAX) || null,
  };
}

function mapRow(r: {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  job_title: string | null;
  department: string | null;
  company_name: string | null;
  app_user_id: string | null;
  app_user_email: string | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_meeting_at: Date | string | null;
}): Participant {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    email: r.email,
    jobTitle: r.job_title,
    department: r.department,
    companyName: r.company_name,
    appUserId: r.app_user_id,
    appUserEmail: r.app_user_email,
    status: r.status as ParticipantStatus,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    lastMeetingAt: r.last_meeting_at ? new Date(r.last_meeting_at) : null,
  };
}

const SELECT_BASE = `
  SELECT p.id, p.company_id, p.name, p.email, p.job_title, p.department, p.company_name,
         p.app_user_id, u.email AS app_user_email, p.status, p.created_at, p.updated_at, p.last_meeting_at
  FROM participant p
  LEFT JOIN app_user u ON u.id = p.app_user_id`;

export async function createParticipant(
  db: SqlExecutor,
  companyId: string,
  input: ParticipantInput,
): Promise<Participant> {
  const f = normalize(input);
  if (f.name.length < 2) throw new Error('Informe o nome do participante.');
  const { originId } = await auditedClinicalWrite(
    db,
    { triggeredBy: 'participant-create', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO participant (company_id, name, email, job_title, department, company_name)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [companyId, f.name, f.email, f.jobTitle, f.department, f.companyName],
      );
      return res.rows[0]!.id;
    },
  );
  const participant = await getParticipant(db, companyId, originId);
  if (!participant) throw new Error('Falha ao criar participante.');
  return participant;
}

export async function updateParticipant(
  db: SqlExecutor,
  companyId: string,
  participantId: string,
  input: ParticipantInput,
): Promise<void> {
  const f = normalize(input);
  if (f.name.length < 2) throw new Error('Informe o nome do participante.');
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'participant-edit', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `UPDATE participant
           SET name = $3, email = $4, job_title = $5, department = $6, company_name = $7, updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [participantId, companyId, f.name, f.email, f.jobTitle, f.department, f.companyName],
      );
      return null;
    },
  );
}

/** Ativo/Inativo — nunca exclusão física (preserva histórico de reuniões/analytics). */
export async function setParticipantStatus(
  db: SqlExecutor,
  companyId: string,
  participantId: string,
  status: ParticipantStatus,
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: `participant-${status}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('UPDATE participant SET status = $3, updated_at = now() WHERE id = $1 AND company_id = $2', [
        participantId,
        companyId,
        status,
      ]);
      return null;
    },
  );
}

/** Vincula (ou desvincula, `appUserId: null`) este participante a uma conta do sistema — nunca cria login. */
export async function linkParticipantToAppUser(
  db: SqlExecutor,
  companyId: string,
  participantId: string,
  appUserId: string | null,
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'participant-link-user', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('UPDATE participant SET app_user_id = $3, updated_at = now() WHERE id = $1 AND company_id = $2', [
        participantId,
        companyId,
        appUserId,
      ]);
      return null;
    },
  );
}

export async function getParticipant(db: SqlExecutor, companyId: string, id: string): Promise<Participant | null> {
  const res = await db.query(`${SELECT_BASE} WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
  const row = res.rows[0] as Parameters<typeof mapRow>[0] | undefined;
  return row ? mapRow(row) : null;
}

/** Lista com busca (nome/email/cargo) + filtros — tabela principal de /participants. */
export async function listParticipants(
  db: SqlExecutor,
  companyId: string,
  filters: ParticipantFilters = {},
): Promise<Participant[]> {
  const conditions = ['p.company_id = $1'];
  const params: unknown[] = [companyId];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (filters.department) {
    params.push(filters.department);
    conditions.push(`p.department = $${params.length}`);
  }
  if (filters.q?.trim()) {
    params.push(`%${filters.q.trim().toLowerCase()}%`);
    conditions.push(
      `(lower(p.name) LIKE $${params.length} OR lower(coalesce(p.email,'')) LIKE $${params.length} OR lower(coalesce(p.job_title,'')) LIKE $${params.length})`,
    );
  }
  const res = await db.query(`${SELECT_BASE} WHERE ${conditions.join(' AND ')} ORDER BY p.name ASC`, params);
  return (res.rows as Array<Parameters<typeof mapRow>[0]>).map(mapRow);
}

/** Departamentos distintos já cadastrados — popula o filtro sem lista fixa. */
export async function listParticipantDepartments(db: SqlExecutor, companyId: string): Promise<string[]> {
  const res = await db.query<{ department: string }>(
    `SELECT DISTINCT department FROM participant WHERE company_id = $1 AND department IS NOT NULL ORDER BY department ASC`,
    [companyId],
  );
  return res.rows.map((r) => r.department);
}

/** Marca a participação mais recente — chamado ao mapear locutores de uma reunião encerrada. */
export async function touchParticipantLastMeeting(
  db: SqlExecutor,
  participantIds: readonly string[],
): Promise<void> {
  if (participantIds.length === 0) return;
  await db.query('UPDATE participant SET last_meeting_at = now() WHERE id = ANY($1)', [participantIds]);
}
