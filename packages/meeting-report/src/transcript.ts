import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { writeAudit, auditedClinicalWrite } from '@conselho/audit';

/**
 * Transcript da reunião — persistência incremental + revisão pelo empresário.
 *
 * Cada segmento FINAL do STT vira uma linha cifrada no ato (a transcrição
 * sobrevive a deploy/restart no meio da reunião). Os finais crus ficam
 * intactos como proveniência; a revisão do empresário (o que de fato foi
 * dito) é a fonte dos relatórios quando existe.
 */

// ── Segmentos crus do STT ───────────────────────────────────────────────────

/**
 * Persiste um segmento FINAL do transcript (cifrado). SEM writeAudit por
 * segmento de propósito (inundaria o audit_log — a sessão audita uma única
 * vez em transcript-persist-start).
 */
export async function saveTranscriptSegment(
  db: SqlExecutor,
  meetingId: string,
  seq: number,
  text: string,
  encryptionKey: Buffer,
): Promise<void> {
  await db.query(
    `INSERT INTO transcript_segment (meeting_id, seq, content_enc) VALUES ($1, $2, $3)
     ON CONFLICT (meeting_id, seq) DO NOTHING`,
    [meetingId, seq, encryptField(text, encryptionKey)],
  );
}

/** Marca (auditada) o início da persistência de transcript da sessão — 1x por sessão. */
export async function auditTranscriptPersistStart(
  db: SqlExecutor,
  meetingId: string,
): Promise<void> {
  await writeAudit(db, meetingId, {
    triggeredBy: 'transcript-persist-start',
    kbSources: [],
    modelVersion: 'n/a',
  });
}

/** Segmentos finais persistidos da reunião, decifrados, em ordem (seq). */
export async function listTranscriptFinals(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<string[]> {
  const res = await db.query<{ content_enc: string }>(
    'SELECT content_enc FROM transcript_segment WHERE meeting_id = $1 ORDER BY seq ASC',
    [meetingId],
  );
  return res.rows.map((r) => decryptField(r.content_enc, encryptionKey));
}

/** Conta os segmentos persistidos SEM decifrar (poll do painel de diagnóstico). */
export async function countTranscriptFinals(db: SqlExecutor, meetingId: string): Promise<number> {
  const res = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) AS count FROM transcript_segment WHERE meeting_id = $1',
    [meetingId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

// ── Sínteses do Presidente persistidas (histórico da reunião) ───────────────

export interface BoardSynthesis {
  readonly id: string;
  readonly meetingId: string;
  readonly content: string;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
}

/**
 * Persiste uma síntese do Presidente (cifrada + auditada ATOMICAMENTE) no
 * momento em que é gerada. Append-only por design.
 */
export async function saveSynthesis(
  db: SqlExecutor,
  meetingId: string,
  content: string,
  encryptionKey: Buffer,
  modelVersion?: string,
): Promise<string> {
  const { originId } = await auditedClinicalWrite(
    db,
    { triggeredBy: 'board-synthesis', kbSources: [], modelVersion: modelVersion ?? 'unknown' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        'INSERT INTO board_synthesis (meeting_id, content_enc, model_version) VALUES ($1, $2, $3) RETURNING id',
        [meetingId, encryptField(content, encryptionKey), modelVersion ?? null],
      );
      return res.rows[0]!.id;
    },
  );
  return originId;
}

/** Sínteses salvas da reunião, decifradas, em ordem cronológica. */
export async function listSyntheses(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<BoardSynthesis[]> {
  const res = await db.query<{
    id: string;
    content_enc: string;
    model_version: string | null;
    created_at: Date;
  }>(
    `SELECT id, content_enc, model_version, created_at
     FROM board_synthesis WHERE meeting_id = $1
     ORDER BY created_at ASC, id ASC`,
    [meetingId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    meetingId,
    content: decryptField(r.content_enc, encryptionKey),
    modelVersion: r.model_version,
    createdAt: new Date(r.created_at),
  }));
}

// ── Transcrição revisada pelo empresário ────────────────────────────────────

export interface TranscriptReview {
  readonly meetingId: string;
  readonly content: string;
  readonly updatedAt: Date;
}

/**
 * Salva a transcrição CORRIGIDA pelo empresário (cifrada + auditada
 * atomicamente). Os finais crus do STT NÃO são tocados — ficam como
 * proveniência do que a máquina ouviu.
 */
export async function saveTranscriptReview(
  db: SqlExecutor,
  meetingId: string,
  content: string,
  encryptionKey: Buffer,
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'transcript-reviewed', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const existing = await tx.query<{ id: string }>(
        'SELECT id FROM transcript_review WHERE meeting_id = $1',
        [meetingId],
      );
      if (existing.rows.length > 0) {
        await tx.query(
          'UPDATE transcript_review SET content_enc = $2, updated_at = now() WHERE meeting_id = $1',
          [meetingId, contentEnc],
        );
      } else {
        await tx.query('INSERT INTO transcript_review (meeting_id, content_enc) VALUES ($1, $2)', [
          meetingId,
          contentEnc,
        ]);
      }
      return meetingId;
    },
  );
}

/** Carrega a transcrição revisada (null se o empresário ainda não corrigiu). */
export async function loadTranscriptReview(
  db: SqlExecutor,
  meetingId: string,
  encryptionKey: Buffer,
): Promise<TranscriptReview | null> {
  const res = await db.query<{ content_enc: string; updated_at: Date | string }>(
    'SELECT content_enc, updated_at FROM transcript_review WHERE meeting_id = $1',
    [meetingId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    meetingId,
    content: decryptField(row.content_enc, encryptionKey),
    updatedAt: new Date(row.updated_at),
  };
}
