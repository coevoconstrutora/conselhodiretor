import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { decryptField, encryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { applyCompanyProfile, type CompanyProfile } from '@conselho/kb';
import { fetchUrlText, buildPreview } from './kb-sources';

/**
 * Perfil da empresa — área central de contexto compartilhado por TODOS os 9
 * conselheiros DE UMA EMPRESA (ver packages/kb/company-profile.ts). Linha
 * única por empresa (PK=company_id) + documentos anexados (company_source,
 * mesmo padrão do kb_source: texto/link/arquivo). Tudo cifrado em repouso.
 *
 * `sourcesText` entra em TODO prompt de TODO agente (não é RAG retido por
 * query como o kb_source por conselheiro) — por isso o teto de tamanho:
 * documento inteiro em todo prompt custa caro em tokens x9 conselheiros.
 */

const MAX_SOURCE_CHARS = 200_000; // por fonte — igual ao kb_source
const MAX_SOURCES_TEXT_CHARS = 6_000; // total injetado no prompt (teto de custo)

export type CompanySourceKind = 'text' | 'url' | 'file';

export interface CompanySourceSummary {
  readonly id: string;
  readonly kind: CompanySourceKind;
  readonly title: string;
  readonly ref: string | null;
  readonly chars: number;
  readonly createdAt: Date;
  /** Só faz sentido para `kind: 'url'` — revisão automática a cada N dias. */
  readonly rescanDays: number | null;
  readonly lastScannedAt: Date | null;
}

/**
 * `name` vem SEMPRE de `company.name` (a identidade do tenant — mesma que
 * aparece no seletor/admin de empresas), nunca do blob cifrado — assim
 * renomear aqui e em /admin/companies é sempre a MESMA fonte de verdade.
 */
export async function loadCompanyProfile(db: SqlExecutor, companyId: string, key: Buffer): Promise<CompanyProfile> {
  const companyRow = await db.query<{ name: string }>('SELECT name FROM company WHERE id = $1', [companyId]);
  const name = companyRow.rows[0]?.name;

  const res = await db.query<{ content_enc: string }>(
    'SELECT content_enc FROM company_profile WHERE company_id = $1',
    [companyId],
  );
  const row = res.rows[0];
  if (!row) return { name };
  try {
    const parsed = JSON.parse(decryptField(row.content_enc, key)) as Record<string, unknown>;
    // `region` era string livre antes desta etapa — normaliza pra array em
    // registros antigos, sem exigir migration (o perfil inteiro é 1 JSON só).
    const rawRegion = parsed.region;
    const region = Array.isArray(rawRegion)
      ? (rawRegion as string[])
      : typeof rawRegion === 'string' && rawRegion.trim()
        ? [rawRegion.trim()]
        : undefined;
    const stored = parsed as unknown as CompanyProfile;
    return { ...stored, region, name };
  } catch {
    return { name }; // chave trocada/dado corrompido — degrada para "sem perfil" em vez de derrubar a página
  }
}

/** Documentos anexados (texto/link/arquivo) DA EMPRESA, concatenados e cortados no teto. */
async function loadSourcesText(db: SqlExecutor, companyId: string, key: Buffer): Promise<string> {
  const res = await db.query<{ title: string; content_enc: string }>(
    'SELECT title, content_enc FROM company_source WHERE company_id = $1 ORDER BY created_at ASC',
    [companyId],
  );
  let combined = '';
  for (const row of res.rows) {
    let text: string;
    try {
      text = decryptField(row.content_enc, key);
    } catch {
      continue; // linha corrompida/chave rotacionada — pula, não derruba o bloco
    }
    combined += `\n\n### ${row.title}\n${text}`;
  }
  const trimmed = combined.trim();
  return trimmed.length > MAX_SOURCES_TEXT_CHARS
    ? `${trimmed.slice(0, MAX_SOURCES_TEXT_CHARS)}\n[...documento(s) truncado(s) — teto de ${MAX_SOURCES_TEXT_CHARS} caracteres]`
    : trimmed;
}

/** Carrega do banco (perfil + documentos) DA EMPRESA e APLICA em memória (1º acesso + após salvar). */
export async function loadAndApplyCompanyProfile(db: SqlExecutor, companyId: string, key: Buffer): Promise<void> {
  const [profile, sourcesText] = await Promise.all([
    loadCompanyProfile(db, companyId, key),
    loadSourcesText(db, companyId, key),
  ]);
  applyCompanyProfile(companyId, { ...profile, sourcesText: sourcesText || undefined });
}

export async function saveCompanyProfile(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
  profile: CompanyProfile,
): Promise<void> {
  const contentEnc = encryptField(JSON.stringify(profile), key);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'company-profile-edit', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      // renomeia o tenant (mesma fonte usada no seletor/admin de empresas)
      if (profile.name?.trim()) {
        await tx.query('UPDATE company SET name = $2 WHERE id = $1', [companyId, profile.name.trim()]);
      }
      await tx.query(
        `INSERT INTO company_profile (company_id, content_enc) VALUES ($1, $2)
         ON CONFLICT (company_id) DO UPDATE SET content_enc = EXCLUDED.content_enc, updated_at = now()`,
        [companyId, contentEnc],
      );
      return null;
    },
  );
  await loadAndApplyCompanyProfile(db, companyId, key); // vale imediatamente — sem restart
}

// ── Documentos (texto/link/arquivo) ─────────────────────────────────────────

export async function listCompanySources(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
): Promise<CompanySourceSummary[]> {
  const res = await db.query<{
    id: string;
    kind: string;
    title: string;
    ref: string | null;
    content_enc: string;
    created_at: Date | string;
    rescan_days: number | null;
    last_scanned_at: Date | string | null;
  }>(
    'SELECT id, kind, title, ref, content_enc, created_at, rescan_days, last_scanned_at FROM company_source WHERE company_id = $1 ORDER BY created_at DESC',
    [companyId],
  );
  return res.rows.map((r) => {
    let chars = 0;
    try {
      chars = decryptField(r.content_enc, key).length;
    } catch {
      chars = 0;
    }
    return {
      id: r.id,
      kind: r.kind as CompanySourceKind,
      title: r.title,
      ref: r.ref,
      chars,
      createdAt: new Date(r.created_at),
      rescanDays: r.rescan_days,
      lastScannedAt: r.last_scanned_at ? new Date(r.last_scanned_at) : null,
    };
  });
}

export async function addCompanySource(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
  input: {
    kind: CompanySourceKind;
    title: string;
    ref?: string | null;
    content: string;
    /** Só faz sentido para `kind: 'url'` — revisão automática a cada N dias. */
    rescanDays?: number | null;
  },
): Promise<{ id: string; chars: number; preview: string }> {
  const content = input.content.trim().slice(0, MAX_SOURCE_CHARS);
  if (content.length < 20) throw new Error('Conteúdo curto demais para virar contexto.');
  const rescanDays =
    input.kind === 'url' && input.rescanDays && input.rescanDays > 0
      ? Math.min(Math.round(input.rescanDays), 365)
      : null;
  const { originId } = await auditedClinicalWrite(
    db,
    { triggeredBy: 'company-source-add', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO company_source (company_id, kind, title, ref, content_enc, rescan_days, last_scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $2 = 'url' THEN now() ELSE NULL END)
         RETURNING id`,
        [
          companyId,
          input.kind,
          input.title.trim().slice(0, 160) || 'Sem título',
          input.ref ?? null,
          encryptField(content, key),
          rescanDays,
        ],
      );
      return res.rows[0]!.id;
    },
  );
  await loadAndApplyCompanyProfile(db, companyId, key);
  return { id: originId, chars: content.length, preview: buildPreview(content) };
}

/**
 * Re-busca fontes por LINK vencidas do perfil da EMPRESA — mesmo padrão do
 * `rescanDueUrlSources` por conselheiro (kb-sources.ts), aplicado ao
 * `company_source` compartilhado por todos. Best-effort: chamado ao abrir
 * /company sem bloquear o render.
 */
export async function rescanDueCompanySources(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
): Promise<{ rescanned: number }> {
  const due = await db.query<{ id: string; ref: string | null }>(
    `SELECT id, ref FROM company_source
     WHERE company_id = $1 AND kind = 'url' AND rescan_days IS NOT NULL
       AND (last_scanned_at IS NULL OR last_scanned_at < now() - (rescan_days || ' days')::interval)`,
    [companyId],
  );
  let rescanned = 0;
  for (const row of due.rows) {
    if (!row.ref) continue;
    try {
      const { title, text } = await fetchUrlText(row.ref);
      await auditedClinicalWrite(
        db,
        { triggeredBy: 'company-source-rescan', kbSources: [], modelVersion: 'auto-rescan' },
        async (tx) => {
          await tx.query(
            'UPDATE company_source SET title = $2, content_enc = $3, last_scanned_at = now() WHERE id = $1',
            [row.id, title.trim().slice(0, 160) || 'Sem título', encryptField(text.trim().slice(0, MAX_SOURCE_CHARS), key)],
          );
          return null;
        },
      );
      rescanned += 1;
    } catch (err) {
      console.error(`[empresa] revisão automática de ${row.ref} falhou:`, err);
    }
  }
  if (rescanned > 0) await loadAndApplyCompanyProfile(db, companyId, key);
  return { rescanned };
}

export async function deleteCompanySource(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
  sourceId: string,
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'company-source-delete', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        'DELETE FROM company_source WHERE id = $1 AND company_id = $2 RETURNING id',
        [sourceId, companyId],
      );
      return res.rows[0]?.id ?? null;
    },
  );
  await loadAndApplyCompanyProfile(db, companyId, key);
}
