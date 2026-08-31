import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@conselho/db';
import {
  writeAudit,
  auditedClinicalWrite,
  getAuditTrail,
  IncompleteProvenanceError,
  type AuditProvenance,
} from './audit';


const PROVENANCE: AuditProvenance = {
  triggeredBy: 'mencao-hipertensao',
  kbSources: [
    { source: 'kb/cardio/has-2024.md', chunk: 12 },
    { source: 'kb/cardio/diretriz-sbc.md', chunk: 3 },
  ],
  modelVersion: 'fake-llm-v1',
};

describe('Audit Service — proveniência e trilha (NFR10)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let companyId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
    companyId = company.rows[0]!.id;
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['ceo@conselho.test', 'Empresário', 'x', companyId],
    );
    userId = res.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  /** Escrita sensível representativa (fixture). */
  async function clinicalWrite(tx: SqlExecutor): Promise<string> {
    const res = await tx.query<{ id: string }>(
      'INSERT INTO meeting (user_id, company_id, title_enc) VALUES ($1, $2, $3) RETURNING id',
      [userId, companyId, 'ciphertext-fixture'],
    );
    return res.rows[0]!.id;
  }

  async function countRows(table: 'meeting' | 'audit_log'): Promise<number> {
    const res = await exec.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    return Number(res.rows[0]!.count);
  }

  describe('AC1/AC2/AC6 — proveniência completa persistida e recuperável', () => {
    it('grava entrada com gatilho, fontes de KB e versão de modelo, e recupera pela trilha', async () => {
      const contributionId = randomUUID();
      const auditId = await writeAudit(exec, contributionId, PROVENANCE);
      expect(auditId).toBeTruthy();

      const trail = await getAuditTrail(exec, contributionId);
      expect(trail).toHaveLength(1);
      const entry = trail[0]!;
      expect(entry.contributionId).toBe(contributionId);
      expect(entry.triggeredBy).toBe(PROVENANCE.triggeredBy);
      expect(entry.kbSources).toEqual(PROVENANCE.kbSources);
      expect(entry.modelVersion).toBe(PROVENANCE.modelVersion);
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it('rejeita proveniência incompleta (gatilho, fontes ou versão ausentes)', async () => {
      await expect(
        writeAudit(exec, null, { ...PROVENANCE, triggeredBy: '  ' }),
      ).rejects.toBeInstanceOf(IncompleteProvenanceError);
      await expect(
        writeAudit(exec, null, { ...PROVENANCE, kbSources: undefined as unknown as unknown[] }),
      ).rejects.toBeInstanceOf(IncompleteProvenanceError);
      await expect(
        writeAudit(exec, null, { ...PROVENANCE, modelVersion: '' }),
      ).rejects.toBeInstanceOf(IncompleteProvenanceError);
    });
  });

  describe('AC3 — atomicidade: escrita clínica sem auditoria é impossível', () => {
    it('proveniência incompleta reverte a escrita clínica inteira', async () => {
      const meetingsBefore = await countRows('meeting');
      const auditsBefore = await countRows('audit_log');

      await expect(
        auditedClinicalWrite(exec, { ...PROVENANCE, modelVersion: '' }, clinicalWrite),
      ).rejects.toBeInstanceOf(IncompleteProvenanceError);

      expect(await countRows('meeting')).toBe(meetingsBefore);
      expect(await countRows('audit_log')).toBe(auditsBefore);
    });

    it('falha na escrita clínica não deixa auditoria órfã', async () => {
      const auditsBefore = await countRows('audit_log');
      await expect(
        auditedClinicalWrite(exec, PROVENANCE, async () => {
          throw new Error('falha clínica simulada');
        }),
      ).rejects.toThrow('falha clínica simulada');
      expect(await countRows('audit_log')).toBe(auditsBefore);
    });

    it('caminho feliz: escrita clínica e auditoria comitam juntas', async () => {
      const { originId, auditId } = await auditedClinicalWrite(exec, PROVENANCE, clinicalWrite);
      expect(originId).toBeTruthy();
      expect(auditId).toBeTruthy();

      const trail = await getAuditTrail(exec, originId);
      expect(trail.map((e) => e.id)).toContain(auditId);
    });
  });

  describe('AC4 — imutabilidade: trilha é append-only no banco', () => {
    it('UPDATE em audit_log é rejeitado pelo trigger', async () => {
      const contributionId = randomUUID();
      const auditId = await writeAudit(exec, contributionId, PROVENANCE);
      await expect(
        exec.query("UPDATE audit_log SET model_version = 'adulterado' WHERE id = $1", [auditId]),
      ).rejects.toThrow(/append-only/);
    });

    it('DELETE em audit_log é rejeitado pelo trigger', async () => {
      const contributionId = randomUUID();
      const auditId = await writeAudit(exec, contributionId, PROVENANCE);
      await expect(exec.query('DELETE FROM audit_log WHERE id = $1', [auditId])).rejects.toThrow(
        /append-only/,
      );
      // A entrada segue íntegra na trilha.
      const trail = await getAuditTrail(exec, contributionId);
      expect(trail.map((e) => e.id)).toContain(auditId);
    });

    it('colunas de proveniência são NOT NULL no schema', async () => {
      await expect(
        exec.query(
          'INSERT INTO audit_log (contribution_id, triggered_by, kb_sources, model_version) VALUES ($1, NULL, NULL, NULL)',
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});
