import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { decryptField, encryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import { applyCompanyProfile, type CompanyProfile } from '@conselho/kb';

/**
 * Perfil da empresa — área central de contexto compartilhado por TODOS os 9
 * conselheiros (ver packages/kb/company-profile.ts). Linha única (id=1),
 * conteúdo cifrado em repouso (JSON com nome/porte/segmento/região/notas —
 * dados de negócio sensíveis, mesmo padrão do kb_source).
 */

export async function loadCompanyProfile(db: SqlExecutor, key: Buffer): Promise<CompanyProfile> {
  const res = await db.query<{ content_enc: string }>(
    'SELECT content_enc FROM company_profile WHERE id = 1',
  );
  const row = res.rows[0];
  if (!row) return {};
  try {
    return JSON.parse(decryptField(row.content_enc, key)) as CompanyProfile;
  } catch {
    return {}; // chave trocada/dado corrompido — degrada para "sem perfil" em vez de derrubar a página
  }
}

/** Carrega do banco e APLICA em memória (boot + logo após salvar). */
export async function loadAndApplyCompanyProfile(db: SqlExecutor, key: Buffer): Promise<void> {
  applyCompanyProfile(await loadCompanyProfile(db, key));
}

export async function saveCompanyProfile(
  db: SqlExecutor,
  key: Buffer,
  profile: CompanyProfile,
): Promise<void> {
  const contentEnc = encryptField(JSON.stringify(profile), key);
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'company-profile-edit', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO company_profile (id, content_enc) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET content_enc = EXCLUDED.content_enc, updated_at = now()`,
        [contentEnc],
      );
      return null;
    },
  );
  applyCompanyProfile(profile); // vale imediatamente — sem restart (mesmo padrão do agent_profile)
}
