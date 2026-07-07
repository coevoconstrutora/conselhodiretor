import type { SqlExecutor, AuditLogRow } from '@conselho/db';

/**
 * Audit Service (NFR10 / Story 1.5) — trilha de auditoria com proveniência.
 *
 * Postura regulatória "IA assiste, médico decide" (ADR-006): toda escrita de
 * dado clínico DEVE gerar uma entrada de auditoria com proveniência completa
 * (gatilho, fontes de KB, versão de modelo), de forma ATÔMICA — falha de
 * auditoria reverte a escrita clínica (sem janela de escrita não auditada).
 *
 * A imutabilidade da trilha (append-only) é garantida no banco pela migration
 * `0003_audit_provenance` (trigger que rejeita UPDATE/DELETE), independente
 * da camada de aplicação.
 *
 * Transações: {@link auditedClinicalWrite} usa `db.transaction()` — a
 * implementação do executor garante conexão única (PGlite roda direto; o
 * executor `pg` pega um client dedicado do Pool). Não há como quebrar a
 * atomicidade passando um Pool por engano (correção de dívida do NutriMed).
 */

/** Proveniência obrigatória de toda contribuição da IA (architecture §8). */
export interface AuditProvenance {
  /** Gatilho que disparou a contribuição (Trigger Detector — E4). */
  triggeredBy: string;
  /** Fontes da base de conhecimento usadas (RAG por persona — E5). */
  kbSources: unknown[];
  /** Versão do modelo que gerou a contribuição. */
  modelVersion: string;
}

/** Entrada da trilha de auditoria, como retornada pela consulta (AC5). */
export interface AuditEntry {
  id: string;
  contributionId: string | null;
  triggeredBy: string;
  kbSources: unknown;
  modelVersion: string;
  createdAt: Date;
}

/** Lançado quando a proveniência está incompleta — a escrita clínica não prossegue. */
export class IncompleteProvenanceError extends Error {
  constructor(missing: string) {
    super(`Auditoria rejeitada: proveniência incompleta (${missing}) — NFR10 exige gatilho, fontes de KB e versão de modelo.`);
    this.name = 'IncompleteProvenanceError';
  }
}

function assertProvenance(p: AuditProvenance): void {
  if (!p.triggeredBy?.trim()) throw new IncompleteProvenanceError('triggeredBy');
  if (!Array.isArray(p.kbSources)) throw new IncompleteProvenanceError('kbSources');
  if (!p.modelVersion?.trim()) throw new IncompleteProvenanceError('modelVersion');
}

/**
 * Grava uma entrada de auditoria (AC1/AC2). Valida a completude da proveniência
 * ANTES de tocar o banco. Retorna o id da entrada criada.
 *
 * Deve ser chamada dentro da mesma transação da escrita clínica — use
 * {@link auditedClinicalWrite} como invólucro padrão.
 */
export async function writeAudit(
  db: SqlExecutor,
  contributionId: string | null,
  provenance: AuditProvenance,
): Promise<string> {
  assertProvenance(provenance);
  const res = await db.query<{ id: string }>(
    `INSERT INTO audit_log (contribution_id, triggered_by, kb_sources, model_version)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      contributionId,
      provenance.triggeredBy,
      JSON.stringify(provenance.kbSources),
      provenance.modelVersion,
    ],
  );
  return res.rows[0]!.id;
}

/**
 * GATE ATÔMICO (AC3) — invólucro padrão para TODA escrita de dado clínico.
 *
 * Executa `write` e a gravação de auditoria na MESMA transação: se qualquer
 * uma falhar (inclusive proveniência incompleta), tudo é revertido. A escrita
 * clínica só é considerada concluída com a auditoria persistida junto.
 *
 * `write` retorna o id de origem (ex.: contribution_id) usado na auditoria;
 * retorne `null` quando a origem ainda não tem entidade própria (pré-E4).
 */
export async function auditedClinicalWrite<T extends string | null>(
  db: SqlExecutor,
  provenance: AuditProvenance,
  write: (tx: SqlExecutor) => Promise<T>,
): Promise<{ originId: T; auditId: string }> {
  // Falha rápida: proveniência incompleta nem abre transação.
  assertProvenance(provenance);
  return db.transaction(async (tx) => {
    const originId = await write(tx);
    const auditId = await writeAudit(tx, originId, provenance);
    return { originId, auditId };
  });
}

/** Consulta a trilha de auditoria por contribuição/origem (AC5 — defesa/inspeção). */
export async function getAuditTrail(
  db: SqlExecutor,
  contributionId: string,
): Promise<AuditEntry[]> {
  const res = await db.query<AuditLogRow>(
    `SELECT id, contribution_id, triggered_by, kb_sources, model_version, created_at
     FROM audit_log WHERE contribution_id = $1 ORDER BY created_at ASC, id ASC`,
    [contributionId],
  );
  return res.rows.map(toEntry);
}

function toEntry(row: AuditLogRow): AuditEntry {
  return {
    id: row.id,
    contributionId: row.contribution_id,
    triggeredBy: row.triggered_by,
    kbSources: typeof row.kb_sources === 'string' ? JSON.parse(row.kb_sources) : row.kb_sources,
    modelVersion: row.model_version,
    createdAt: new Date(row.created_at),
  };
}
