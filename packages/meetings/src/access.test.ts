import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@conselho/db';
import { createMeeting, listMeetings, getMeeting, closeMeeting } from './meetings';
import {
  canAccessMeeting,
  setMeetingConfidential,
  shareMeeting,
  unshareMeeting,
  listMeetingShares,
  meetingVisibleSql,
} from './access';

describe('Reunião confidencial e compartilhamento', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let companyId: string;
  let otherCompanyId: string;
  const key = randomBytes(32);
  const users: Record<'owner' | 'peer' | 'attendee' | 'outsider', string> = {
    owner: '',
    peer: '',
    attendee: '',
    outsider: '',
  };
  let openMeeting: string;
  let secretMeeting: string;

  async function makeUser(email: string, name: string, company: string, member = true): Promise<string> {
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, name, 'x', company],
    );
    if (member) await exec.query("INSERT INTO company_member (user_id, company_id, role) VALUES ($1, $2, 'gestor')", [res.rows[0]!.id, company]);
    return res.rows[0]!.id;
  }

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    companyId = (await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'")).rows[0]!.id;
    otherCompanyId = (
      await exec.query<{ id: string }>("INSERT INTO company (name, slug) VALUES ('Outra', 'outra') RETURNING id")
    ).rows[0]!.id;
    users.owner = await makeUser('dono@t.test', 'Dona Reunião', companyId);
    users.peer = await makeUser('colega@t.test', 'Colega', companyId);
    users.attendee = await makeUser('presente@t.test', 'Presente', companyId);
    users.outsider = await makeUser('fora@t.test', 'De Fora', otherCompanyId);

    openMeeting = await createMeeting(exec, users.owner, companyId, 'Reunião aberta', key);
    secretMeeting = await createMeeting(exec, users.owner, companyId, 'Reunião secreta', key, null, null, null, null, true);
  });

  afterAll(async () => {
    await db.close();
  });

  const viewer = (userId: string) => ({ userId, companyId });

  it('reunião aberta: toda a empresa vê; outra empresa não', async () => {
    expect(await canAccessMeeting(exec, openMeeting, viewer(users.peer))).toBe(true);
    expect(await canAccessMeeting(exec, openMeeting, { userId: users.outsider, companyId: otherCompanyId })).toBe(false);
  });

  it('confidencial: só o criador vê; colega da empresa não vê (nem na lista, nem por id)', async () => {
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.owner))).toBe(true);
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.peer))).toBe(false);
    expect(await getMeeting(exec, secretMeeting, companyId, key, users.peer)).toBeNull();

    const peerList = (await listMeetings(exec, companyId, key, users.peer)).map((m) => m.title);
    expect(peerList).toContain('Reunião aberta');
    expect(peerList).not.toContain('Reunião secreta');
    const ownerList = await listMeetings(exec, companyId, key, users.owner);
    const secret = ownerList.find((m) => m.title === 'Reunião secreta')!;
    expect(secret.confidential).toBe(true);
    expect(secret.creatorName).toBe('Dona Reunião');
  });

  it('só o criador marca confidencial e compartilha; alvo precisa ser membro da empresa', async () => {
    expect(await setMeetingConfidential(exec, openMeeting, users.peer, companyId, true)).toBe(false);
    expect(await shareMeeting(exec, secretMeeting, users.peer, companyId, users.attendee)).toBe('not_owner');
    expect(await shareMeeting(exec, secretMeeting, users.owner, companyId, users.owner)).toBe('self');
    expect(await shareMeeting(exec, secretMeeting, users.owner, companyId, users.outsider)).toBe('not_member');
  });

  it('compartilhar dá acesso; remover tira', async () => {
    expect(await shareMeeting(exec, secretMeeting, users.owner, companyId, users.peer)).toBe('ok');
    expect(await shareMeeting(exec, secretMeeting, users.owner, companyId, users.peer)).toBe('ok'); // idempotente
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.peer))).toBe(true);
    expect((await listMeetingShares(exec, secretMeeting)).map((s) => s.userId)).toEqual([users.peer]);
    const shared = (await listMeetings(exec, companyId, key, users.owner)).find((m) => m.title === 'Reunião secreta')!;
    expect(shared.sharedCount).toBe(1);

    expect(await unshareMeeting(exec, secretMeeting, users.peer, companyId, users.peer)).toBe(false); // não é dono
    expect(await unshareMeeting(exec, secretMeeting, users.owner, companyId, users.peer)).toBe(true);
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.peer))).toBe(false);
  });

  it('quem esteve presente e tem conta vinculada enxerga a confidencial', async () => {
    const participant = await exec.query<{ id: string }>(
      'INSERT INTO participant (company_id, name, app_user_id) VALUES ($1, $2, $3) RETURNING id',
      [companyId, 'Presente (participante)', users.attendee],
    );
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.attendee))).toBe(false);
    await exec.query(
      `INSERT INTO meeting_speaker (meeting_id, speaker_label, participant_id, identification_status)
       VALUES ($1, 'Locutor 1', $2, 'identified')`,
      [secretMeeting, participant.rows[0]!.id],
    );
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.attendee))).toBe(true);
    const item = (await listMeetings(exec, companyId, key, users.owner)).find((m) => m.title === 'Reunião secreta')!;
    expect(item.attendees).toEqual(['Presente (participante)']);
  });

  it('tirar a confidencialidade reabre para a empresa', async () => {
    expect(await setMeetingConfidential(exec, secretMeeting, users.owner, companyId, false)).toBe(true);
    expect(await canAccessMeeting(exec, secretMeeting, viewer(users.peer))).toBe(true);
    await setMeetingConfidential(exec, secretMeeting, users.owner, companyId, true);
  });

  it('agregados: sem usuário (uso sistêmico) confidencial nunca entra', async () => {
    const res = await exec.query<{ id: string }>(
      `SELECT m.id FROM meeting m WHERE m.company_id = $1 AND ${meetingVisibleSql('m', '$2')}`,
      [companyId, null],
    );
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(openMeeting);
    expect(ids).not.toContain(secretMeeting);
  });

  it('contexto da reunião anterior: confidencial sem acesso é ignorada na criação', async () => {
    await closeMeeting(exec, secretMeeting, companyId, users.owner);
    const blocked = await createMeeting(exec, users.peer, companyId, 'Nova do colega', key, null, null, secretMeeting);
    const row = await exec.query<{ previous_context_meeting_id: string | null }>(
      'SELECT previous_context_meeting_id FROM meeting WHERE id = $1',
      [blocked],
    );
    expect(row.rows[0]!.previous_context_meeting_id).toBeNull();
    const allowed = await createMeeting(exec, users.owner, companyId, 'Nova da dona', key, null, null, secretMeeting);
    const row2 = await exec.query<{ previous_context_meeting_id: string | null }>(
      'SELECT previous_context_meeting_id FROM meeting WHERE id = $1',
      [allowed],
    );
    expect(row2.rows[0]!.previous_context_meeting_id).toBe(secretMeeting);
  });

  it('encerrar reunião exige acesso quando o usuário é informado', async () => {
    const m = await createMeeting(exec, users.owner, companyId, 'Para encerrar', key, null, null, null, null, true);
    await expect(closeMeeting(exec, m, companyId, users.peer)).rejects.toThrow('não encontrada');
    await expect(closeMeeting(exec, m, companyId, users.owner)).resolves.toBeUndefined();
  });
});
