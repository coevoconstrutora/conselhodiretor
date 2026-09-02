import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { encryptField, decryptField } from '@conselho/crypto';
import { runMigrations, type SqlExecutor } from './migrate';
import { pgliteExecutor } from './testing';

/** Adapta o PGlite (Postgres in-process, WASM) ao SqlExecutor — testes sem Docker. */

let db: PGlite;
let exec: SqlExecutor;
let firstRun: string[];
let companyId: string;
const key = randomBytes(32);

async function insertUser(email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, company_id) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Empresário Teste', companyId],
  );
  return res.rows[0]!.id;
}

async function insertMeeting(userId: string, title = 'Reunião de diretoria'): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO meeting (user_id, company_id, title_enc) VALUES ($1, $2, $3) RETURNING id',
    [userId, companyId, encryptField(title, key)],
  );
  return res.rows[0]!.id;
}

beforeAll(async () => {
  db = new PGlite();
  exec = pgliteExecutor(db);
  firstRun = await runMigrations(exec);
  const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
  companyId = company.rows[0]!.id;
});

afterAll(async () => {
  await db.close();
});

describe('Migrations — schema base', () => {
  it('aplica as migrations do zero', () => {
    expect(firstRun).toEqual([
      '0001_init',
      '0002_audit_log',
      '0003_transcript',
      '0004_board_outputs',
      '0005_counselor_knowledge',
      '0006_users_roles',
      '0007_company_profile',
      '0008_company_sources',
      '0009_meeting_summary',
      '0010_multi_company',
      '0011_company_membership',
      '0012_meeting_types',
      '0013_custom_counselors',
      '0014_kb_source_rescan',
      '0015_agent_profile_scope_split',
      '0016_agent_profile_icon',
      '0017_agent_profile_decision_context',
      '0018_agent_profile_icon_color',
      '0019_meeting_improvement',
      '0020_voice_profile',
      '0021_meeting_guidance',
      '0022_agent_profile_briefing',
      '0023_agent_profile_ai_voice_config',
      '0024_president_config',
      '0025_participants_biometrics',
    ]);
  });

  it('é idempotente — reexecutar não reaplica nada', async () => {
    expect(await runMigrations(exec)).toEqual([]);
  });

  it('cria as entidades base', async () => {
    const expected = [
      'agent_report',
      'app_user',
      'audit_log',
      'board_synthesis',
      'meeting',
      'session',
      'transcript_review',
      'transcript_segment',
    ];
    const res = await exec.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [expected],
    );
    expect(res.rows.map((r) => r.table_name).sort()).toEqual(expected);
  });
});

describe('Criptografia em repouso — AES-256-GCM', () => {
  it('persiste o título da reunião ILEGÍVEL em claro e recuperável só com a chave', async () => {
    const userId = await insertUser('cripto@conselho.test');
    const plaintext = 'Reunião confidencial — aquisição do terreno da Av. Central';
    const meetingId = await insertMeeting(userId, plaintext);

    const raw = await exec.query<{ title_enc: string }>(
      'SELECT title_enc FROM meeting WHERE id = $1',
      [meetingId],
    );
    const stored = raw.rows[0]!.title_enc;
    expect(stored).not.toContain('Av. Central');
    expect(decryptField(stored, key)).toBe(plaintext);
  });
});

describe('Gate de gravação — default NEGA', () => {
  it('reunião nasce com recording_confirmed = false', async () => {
    const userId = await insertUser('gate@conselho.test');
    const meetingId = await insertMeeting(userId);
    const res = await exec.query<{ recording_confirmed: boolean }>(
      'SELECT recording_confirmed FROM meeting WHERE id = $1',
      [meetingId],
    );
    expect(res.rows[0]!.recording_confirmed).toBe(false);
  });
});

describe('audit_log — append-only via trigger', () => {
  it('rejeita UPDATE e DELETE no banco', async () => {
    const inserted = await exec.query<{ id: string }>(
      `INSERT INTO audit_log (contribution_id, triggered_by, kb_sources, model_version)
       VALUES (NULL, 'teste', '[]'::jsonb, 'test-1') RETURNING id`,
    );
    const id = inserted.rows[0]!.id;
    await expect(
      exec.query(`UPDATE audit_log SET model_version = 'x' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(exec.query(`DELETE FROM audit_log WHERE id = $1`, [id])).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('transcript_segment — persistência incremental', () => {
  it('grava segmentos cifrados em ordem e rejeita seq duplicado', async () => {
    const userId = await insertUser('transcript@conselho.test');
    const meetingId = await insertMeeting(userId);
    await exec.query(
      'INSERT INTO transcript_segment (meeting_id, seq, content_enc) VALUES ($1, 1, $2)',
      [meetingId, encryptField('primeiro segmento', key)],
    );
    await expect(
      exec.query(
        'INSERT INTO transcript_segment (meeting_id, seq, content_enc) VALUES ($1, 1, $2)',
        [meetingId, encryptField('duplicado', key)],
      ),
    ).rejects.toThrow();
  });
});

describe('Participantes e biometria de voz (migration 0025)', () => {
  it('participant referencia company e aceita os campos opcionais', async () => {
    const res = await exec.query<{ id: string; status: string }>(
      `INSERT INTO participant (company_id, name, email, job_title, department)
       VALUES ($1, 'Marina Alves', 'marina@coevo.test', 'CFO', 'Financeiro') RETURNING id, status`,
      [companyId],
    );
    expect(res.rows[0]!.status).toBe('active'); // default
  });

  it('participant_biometric_consent preserva histórico — conceder e revogar NUNCA sobrescreve', async () => {
    const participant = await exec.query<{ id: string }>(
      `INSERT INTO participant (company_id, name) VALUES ($1, 'Jonathan Reis') RETURNING id`,
      [companyId],
    );
    const participantId = participant.rows[0]!.id;
    await exec.query(
      `INSERT INTO participant_biometric_consent (participant_id, status, source) VALUES ($1, 'granted', 'admin_enrollment')`,
      [participantId],
    );
    await exec.query(
      `INSERT INTO participant_biometric_consent (participant_id, status, revoked_at, source) VALUES ($1, 'revoked', now(), 'admin_revocation')`,
      [participantId],
    );
    const history = await exec.query<{ status: string }>(
      'SELECT status FROM participant_biometric_consent WHERE participant_id = $1 ORDER BY created_at ASC',
      [participantId],
    );
    expect(history.rows.map((r) => r.status)).toEqual(['granted', 'revoked']); // ambos preservados
  });

  it('voice_profile: novas colunas (participant_id/status/model_*) com defaults compatíveis', async () => {
    const participant = await exec.query<{ id: string }>(
      `INSERT INTO participant (company_id, name) VALUES ($1, 'Ana Paula') RETURNING id`,
      [companyId],
    );
    const participantId = participant.rows[0]!.id;
    const res = await exec.query<{ status: string; model_provider: string; model_version: string }>(
      `INSERT INTO voice_profile (company_id, participant_id, name, embedding_enc)
       VALUES ($1, $2, 'Ana Paula', $3) RETURNING status, model_provider, model_version`,
      [companyId, participantId, encryptField('[0.1,0.2]', key)],
    );
    expect(res.rows[0]).toEqual({ status: 'active', model_provider: 'resemblyzer', model_version: 'v1' });
  });

  it('meeting_speaker: PK composta (meeting_id, speaker_label) rejeita duplicata', async () => {
    const userId = await insertUser('speaker@conselho.test');
    const meetingId = await insertMeeting(userId);
    await exec.query(
      `INSERT INTO meeting_speaker (meeting_id, speaker_label, identification_status) VALUES ($1, 'Locutor 1', 'unknown')`,
      [meetingId],
    );
    await expect(
      exec.query(
        `INSERT INTO meeting_speaker (meeting_id, speaker_label, identification_status) VALUES ($1, 'Locutor 1', 'unknown')`,
        [meetingId],
      ),
    ).rejects.toThrow();
  });

  it('participant_meeting_analytics: PK composta (meeting_id, participant_id) rejeita duplicata', async () => {
    const userId = await insertUser('analytics@conselho.test');
    const meetingId = await insertMeeting(userId);
    const participant = await exec.query<{ id: string }>(
      `INSERT INTO participant (company_id, name) VALUES ($1, 'Carlos Souza') RETURNING id`,
      [companyId],
    );
    const participantId = participant.rows[0]!.id;
    await exec.query(
      `INSERT INTO participant_meeting_analytics (meeting_id, participant_id, speaking_turns) VALUES ($1, $2, 3)`,
      [meetingId, participantId],
    );
    await expect(
      exec.query(
        `INSERT INTO participant_meeting_analytics (meeting_id, participant_id, speaking_turns) VALUES ($1, $2, 5)`,
        [meetingId, participantId],
      ),
    ).rejects.toThrow();
  });
});

describe('agent_report — 1 por agente por reunião', () => {
  it('sobrescreve via UNIQUE (meeting_id, agent_id)', async () => {
    const userId = await insertUser('report@conselho.test');
    const meetingId = await insertMeeting(userId);
    await exec.query(
      'INSERT INTO agent_report (meeting_id, agent_id, content_enc) VALUES ($1, $2, $3)',
      [meetingId, 'cfo', encryptField('v1', key)],
    );
    await expect(
      exec.query(
        'INSERT INTO agent_report (meeting_id, agent_id, content_enc) VALUES ($1, $2, $3)',
        [meetingId, 'cfo', encryptField('v2', key)],
      ),
    ).rejects.toThrow();
  });
});
