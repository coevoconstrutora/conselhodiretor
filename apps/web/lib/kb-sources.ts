import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlExecutor } from '@conselho/db';
import { decryptField, encryptField } from '@conselho/crypto';
import { auditedClinicalWrite } from '@conselho/audit';
import {
  chunkContent,
  seedSources,
  applyAgentProfileOverrides,
  removeAgentProfile,
  getAgentProfiles,
  DEFAULT_AGENT_PROFILES,
  type NamespacedKnowledgeStore,
} from '@conselho/kb';
import type { AgentId, KbChunk } from '@conselho/providers';
import { stripHtml, isBlockedUrl } from './text-extract';

/**
 * "NotebookLM por conselheiro" — fontes de conhecimento geridas pelo DONO.
 * Multi-tenant: toda leitura/escrita é escopada por `companyId` — empresas
 * diferentes NUNCA compartilham fonte, perfil ou namespace de RAG.
 *
 * O namespace de cada agente = seed do repositório (docs/agents-knowledge-seed.md)
 * + fontes persistidas no banco (texto colado, links, arquivos). Toda mudança
 * reconstrói o namespace EM MEMÓRIA na hora — sem reiniciar o servidor.
 * Conteúdo cifrado em repouso (pode carregar estratégia da empresa) e toda
 * escrita é auditada atomicamente.
 */

export type KbSourceKind = 'text' | 'url' | 'file';

export interface KbSourceSummary {
  readonly id: string;
  readonly agentId: AgentId;
  readonly kind: KbSourceKind;
  readonly title: string;
  readonly ref: string | null;
  /** Tamanho do texto extraído (chars) — sem decifrar tudo na listagem. */
  readonly chars: number;
  readonly createdAt: Date;
  /** Só para fontes por LINK: de quantos em quantos dias revisar (null = nunca, manual). */
  readonly rescanDays: number | null;
  readonly lastScannedAt: Date | null;
}

const MAX_SOURCE_CHARS = 200_000; // ~200 KB de texto por fonte — suficiente p/ docs longos

// ── Extração de texto ───────────────────────────────────────────────────────

export { stripHtml, isBlockedUrl } from './text-extract';

/** Baixa uma URL e devolve o texto extraído (HTML → texto; text/* direto). */
export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  if (isBlockedUrl(url)) {
    throw new Error('URL inválida ou não permitida (somente http/https públicos).');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Alguns sites (ex.: planalto.gov.br) derrubam a conexão (ECONNRESET)
        // pra um user-agent não-browser — cabeçalhos de navegador de verdade
        // resolvem sem precisar de proxy/headless. Legítimo: é o dono baixando
        // uma página pública pra alimentar a PRÓPRIA base de conhecimento.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      `Não foi possível acessar a URL: ${timedOut ? 'tempo esgotado (20s)' : 'falha de rede (o site pode estar bloqueando acesso automatizado)'}.` +
        (timedOut ? '' : ' Se persistir, copie o texto da página e use "Colar texto".'),
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`A URL respondeu com erro HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/|application\/(xhtml|xml|json)/i.test(contentType)) {
    throw new Error(
      `Conteúdo não suportado (${contentType.split(';')[0] || 'desconhecido'}) — use páginas de texto/HTML, ou converta para .txt/.md e envie como arquivo.`,
    );
  }
  const rawBody = await response.text();
  const raw = rawBody.slice(0, MAX_SOURCE_CHARS * 4);
  const text = /html/i.test(contentType) ? stripHtml(raw) : raw.trim();
  if (text.length < 40) throw new Error('A página não tem texto útil extraível.');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rawBody);
  const title = stripHtml(titleMatch?.[1] ?? '').slice(0, 120) || new URL(url).hostname;
  return { title, text: text.slice(0, MAX_SOURCE_CHARS) };
}

// ── Persistência das fontes ─────────────────────────────────────────────────

export async function addKbSource(
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
  input: {
    kind: KbSourceKind;
    title: string;
    ref?: string | null;
    content: string;
    /** Só faz sentido para `kind: 'url'` — revisão automática a cada N dias. */
    rescanDays?: number | null;
  },
  encryptionKey: Buffer,
): Promise<{ id: string; chars: number; preview: string }> {
  const content = input.content.trim().slice(0, MAX_SOURCE_CHARS);
  if (content.length < 20) throw new Error('Conteúdo curto demais para virar conhecimento.');
  const rescanDays =
    input.kind === 'url' && input.rescanDays && input.rescanDays > 0
      ? Math.min(Math.round(input.rescanDays), 365)
      : null;
  const { originId } = await auditedClinicalWrite(
    db,
    { triggeredBy: `kb-source-add-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO kb_source (company_id, agent_id, kind, title, ref, content_enc, rescan_days, last_scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $3 = 'url' THEN now() ELSE NULL END)
         RETURNING id`,
        [
          companyId,
          agentId,
          input.kind,
          input.title.trim().slice(0, 160) || 'Sem título',
          input.ref ?? null,
          encryptField(content, encryptionKey),
          rescanDays,
        ],
      );
      return res.rows[0]!.id;
    },
  );
  return { id: originId, chars: content.length, preview: buildPreview(content) };
}

/** Resumo curto do que foi extraído — pro dono conferir sem abrir a fonte. */
function buildPreview(content: string, maxChars = 260): string {
  const flat = content.trim().replace(/\s+/g, ' ');
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

export async function deleteKbSource(
  db: SqlExecutor,
  companyId: string,
  sourceId: string,
  agentId: AgentId,
): Promise<boolean> {
  const { originId } = await auditedClinicalWrite(
    db,
    { triggeredBy: `kb-source-delete-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        'DELETE FROM kb_source WHERE id = $1 AND agent_id = $2 AND company_id = $3 RETURNING id',
        [sourceId, agentId, companyId],
      );
      return res.rows[0]?.id ?? null;
    },
  );
  return originId !== null;
}

/** Lista as fontes de um agente DA EMPRESA (metadados + tamanho; decifra só p/ contar). */
export async function listKbSources(
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
  encryptionKey: Buffer,
): Promise<KbSourceSummary[]> {
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
    'SELECT id, kind, title, ref, content_enc, created_at, rescan_days, last_scanned_at FROM kb_source WHERE company_id = $1 AND agent_id = $2 ORDER BY created_at DESC',
    [companyId, agentId],
  );
  return res.rows.map((r) => {
    let chars = 0;
    try {
      chars = decryptField(r.content_enc, encryptionKey).length;
    } catch {
      chars = 0; // chave rotacionada/linha corrompida — listagem nunca quebra
    }
    return {
      id: r.id,
      agentId,
      kind: r.kind as KbSourceKind,
      title: r.title,
      ref: r.ref,
      chars,
      createdAt: new Date(r.created_at),
      rescanDays: r.rescan_days,
      lastScannedAt: r.last_scanned_at ? new Date(r.last_scanned_at) : null,
    };
  });
}

/**
 * Re-busca fontes por LINK vencidas (`rescan_days` configurado e
 * `last_scanned_at` mais velho que isso) e reconstrói o namespace se algo
 * mudou. Chamado ao abrir a página do conselheiro, sem bloquear o render
 * (best-effort — uma URL fora do ar não deve travar a tela).
 */
export async function rescanDueUrlSources(
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
  encryptionKey: Buffer,
): Promise<{ rescanned: number }> {
  const due = await db.query<{ id: string; ref: string | null }>(
    `SELECT id, ref FROM kb_source
     WHERE company_id = $1 AND agent_id = $2 AND kind = 'url' AND rescan_days IS NOT NULL
       AND (last_scanned_at IS NULL OR last_scanned_at < now() - (rescan_days || ' days')::interval)`,
    [companyId, agentId],
  );
  let rescanned = 0;
  for (const row of due.rows) {
    if (!row.ref) continue;
    try {
      const { title, text } = await fetchUrlText(row.ref);
      await auditedClinicalWrite(
        db,
        { triggeredBy: `kb-source-rescan-${agentId}`, kbSources: [], modelVersion: 'auto-rescan' },
        async (tx) => {
          await tx.query(
            'UPDATE kb_source SET title = $2, content_enc = $3, last_scanned_at = now() WHERE id = $1',
            [row.id, title.trim().slice(0, 160) || 'Sem título', encryptField(text.trim().slice(0, MAX_SOURCE_CHARS), encryptionKey)],
          );
          return null;
        },
      );
      rescanned += 1;
    } catch (err) {
      // fonte fora do ar/mudou de formato — mantém o conteúdo antigo, tenta de novo no próximo vencimento
      console.error(`[kb] revisão automática de ${row.ref} falhou:`, err);
    }
  }
  return { rescanned };
}

/** Contagem de fontes por agente DA EMPRESA (grid da home — 1 query, sem decifrar). */
export async function countKbSourcesByAgent(db: SqlExecutor, companyId: string): Promise<Map<string, number>> {
  const res = await db.query<{ agent_id: string; count: string | number }>(
    'SELECT agent_id, COUNT(*) AS count FROM kb_source WHERE company_id = $1 GROUP BY agent_id',
    [companyId],
  );
  return new Map(res.rows.map((r) => [r.agent_id, Number(r.count)]));
}

// ── Perfis personalizados ───────────────────────────────────────────────────

/** Limite por campo na autoria (UI mostra contador) — "pode" + "não pode" juntos formam o prompt. */
export const SCOPE_FIELD_MAX = 2000;

/** Escopo autoral (2 campos) → 1 texto só, que é o que o prompt de fato lê. */
function buildCombinedScope(scopeCan: string, scopeCannot: string): string {
  const parts: string[] = [];
  if (scopeCan.trim()) parts.push(`PODE opinar sobre: ${scopeCan.trim()}`);
  if (scopeCannot.trim()) parts.push(`NÃO PODE opinar sobre: ${scopeCannot.trim()}`);
  return parts.join('\n\n');
}

/**
 * Escopo em 2 campos pra edição ("o que pode" / "o que não pode" — menos
 * ambíguo que 1 parágrafo só). Sem linha própria ainda (conselheiro padrão
 * nunca editado nesta empresa): cai no `scope` atual do registry em memória
 * como "o que pode", campo "não pode" começa vazio.
 */
export async function loadScopeSplit(
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
): Promise<{ scopeCan: string; scopeCannot: string }> {
  const res = await db.query<{ scope: string; scope_can: string | null; scope_cannot: string | null }>(
    'SELECT scope, scope_can, scope_cannot FROM agent_profile WHERE company_id = $1 AND agent_id = $2',
    [companyId, agentId],
  );
  const row = res.rows[0];
  if (!row) {
    const profile = getAgentProfiles(companyId)[agentId];
    return { scopeCan: profile?.scope ?? '', scopeCannot: '' };
  }
  if (row.scope_can !== null || row.scope_cannot !== null) {
    return { scopeCan: row.scope_can ?? '', scopeCannot: row.scope_cannot ?? '' };
  }
  return { scopeCan: row.scope, scopeCannot: '' }; // linha antiga, de antes do split
}

/** Limite do campo "formação/experiência" — bem menor que o escopo, é um parágrafo de bio, não uma regra. */
export const BIO_MAX = 1000;

export async function saveAgentProfile(
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
  displayName: string,
  scopeCan: string,
  scopeCannot: string,
  iconKey?: string | null,
  bio?: string | null,
): Promise<void> {
  const can = scopeCan.trim().slice(0, SCOPE_FIELD_MAX);
  const cannot = scopeCannot.trim().slice(0, SCOPE_FIELD_MAX);
  const scope = buildCombinedScope(can, cannot);
  const icon = iconKey?.trim() || null;
  const bioText = bio?.trim().slice(0, BIO_MAX) || null;
  await auditedClinicalWrite(
    db,
    { triggeredBy: `agent-profile-edit-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO agent_profile (company_id, agent_id, display_name, scope, scope_can, scope_cannot, icon_key, bio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, agent_id) DO UPDATE
           SET display_name = EXCLUDED.display_name, scope = EXCLUDED.scope,
               scope_can = EXCLUDED.scope_can, scope_cannot = EXCLUDED.scope_cannot,
               icon_key = EXCLUDED.icon_key, bio = EXCLUDED.bio, updated_at = now()`,
        [companyId, agentId, displayName.trim().slice(0, 80), scope, can, cannot, icon, bioText],
      );
      return null; // agent_profile não tem id próprio (PK é company_id+agent_id, ambos não-uuid)
    },
  );
  applyAgentProfileOverrides(companyId, [{ agentId, displayName, scope, iconKey: icon, bio: bioText }]);
}

function slugifyAgentId(displayName: string): string {
  const base = displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  return base || 'conselheiro';
}

/**
 * Cria um conselheiro CUSTOM da empresa (além dos 9 padrão). Gera um
 * `agent_id` (slug) único dentro da empresa, insere o perfil + gatilhos
 * (palavras-chave — não dá pra curar regex automático p/ um escopo
 * desconhecido) e aplica no registry em memória imediatamente.
 */
export async function createCustomCounselor(
  db: SqlExecutor,
  companyId: string,
  displayName: string,
  scopeCan: string,
  scopeCannot: string,
  triggerKeywords: readonly string[],
  iconKey?: string | null,
  bio?: string | null,
): Promise<AgentId> {
  const name = displayName.trim().slice(0, 80);
  const can = scopeCan.trim().slice(0, SCOPE_FIELD_MAX);
  const cannot = scopeCannot.trim().slice(0, SCOPE_FIELD_MAX);
  const scope = buildCombinedScope(can, cannot);
  const icon = iconKey?.trim() || null;
  const bioText = bio?.trim().slice(0, BIO_MAX) || null;
  if (name.length < 3) throw new Error('O nome precisa de pelo menos 3 caracteres.');
  if (can.length < 20) throw new Error('"O que pode" precisa ter pelo menos 20 caracteres.');
  const keywords = triggerKeywords.map((k) => k.trim()).filter(Boolean).slice(0, 30);
  if (keywords.length === 0)
    throw new Error('Informe ao menos uma palavra-chave para o conselheiro reagir na reunião.');

  const existing = new Set(Object.keys(getAgentProfiles(companyId)));
  const base = slugifyAgentId(name);
  let agentId = base;
  let suffix = 2;
  while (existing.has(agentId)) {
    agentId = `${base}-${suffix}`;
    suffix += 1;
  }

  await auditedClinicalWrite(
    db,
    { triggeredBy: `agent-profile-create-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO agent_profile (company_id, agent_id, display_name, scope, scope_can, scope_cannot, trigger_keywords, icon_key, bio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [companyId, agentId, name, scope, can, cannot, keywords, icon, bioText],
      );
      return null;
    },
  );
  applyAgentProfileOverrides(companyId, [
    { agentId: agentId as AgentId, displayName: name, scope, iconKey: icon, bio: bioText },
  ]);
  return agentId as AgentId;
}

/** Remove um conselheiro CUSTOM (nunca um dos 9 padrão) e todo resíduo associado. */
export async function deleteCustomCounselor(db: SqlExecutor, companyId: string, agentId: AgentId): Promise<void> {
  if (agentId in DEFAULT_AGENT_PROFILES) {
    throw new Error('Os 9 conselheiros padrão não podem ser removidos.');
  }
  await auditedClinicalWrite(
    db,
    { triggeredBy: `agent-profile-delete-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('DELETE FROM kb_source WHERE company_id = $1 AND agent_id = $2', [companyId, agentId]);
      await tx.query('DELETE FROM agent_profile WHERE company_id = $1 AND agent_id = $2', [companyId, agentId]);
      // remove o id de qualquer tipo de reunião que o incluía — referência órfã quebraria o combobox
      await tx.query(
        'UPDATE meeting_type SET agent_ids = array_remove(agent_ids, $2) WHERE company_id = $1',
        [companyId, agentId],
      );
      return null;
    },
  );
  removeAgentProfile(companyId, agentId);
}

/** Carrega e APLICA os perfis personalizados da EMPRESA (boot/1º acesso + após edição). */
export async function loadAndApplyProfileOverrides(db: SqlExecutor, companyId: string): Promise<void> {
  const res = await db.query<{
    agent_id: string;
    display_name: string;
    scope: string;
    icon_key: string | null;
    bio: string | null;
  }>('SELECT agent_id, display_name, scope, icon_key, bio FROM agent_profile WHERE company_id = $1', [companyId]);
  applyAgentProfileOverrides(
    companyId,
    res.rows.map((r) => ({
      agentId: r.agent_id as AgentId,
      displayName: r.display_name,
      scope: r.scope,
      iconKey: r.icon_key,
      bio: r.bio,
    })),
  );
}

// ── Reconstrução do conhecimento (seed + fontes do banco) ───────────────────

/** Localiza e lê a seed do repositório (cwd varia: apps/web vs raiz). */
export function readSeedMarkdown(): string {
  const candidates = [
    join(process.cwd(), '..', '..', 'docs', 'agents-knowledge-seed.md'),
    join(process.cwd(), 'docs', 'agents-knowledge-seed.md'),
  ];
  const path = candidates.find((p) => existsSync(p));
  return path ? readFileSync(path, 'utf8') : '';
}

/**
 * Reconstrói o namespace de UM agente DE UMA EMPRESA: chunks da seed + chunks
 * de cada fonte do banco (só as daquela empresa). IDs de chunk levam o id
 * curto da fonte (proveniência na auditoria: `cfo:fonte-ab12cd34:0`).
 * Substituição atômica do namespace (sem resíduo).
 */
export async function rebuildAgentKnowledge(
  store: NamespacedKnowledgeStore,
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
  encryptionKey: Buffer,
): Promise<{ chunkCount: number; sourceCount: number }> {
  if (agentId === 'presidente') return { chunkCount: 0, sourceCount: 0 }; // só sintetiza

  const chunks: KbChunk[] = [];

  const seed = seedSources(readSeedMarkdown()).find((s) => s.agentId === agentId);
  if (seed) chunks.push(...chunkContent(agentId, seed.source, seed.content, 'seed-v1'));

  const res = await db.query<{ id: string; title: string; content_enc: string }>(
    'SELECT id, title, content_enc FROM kb_source WHERE company_id = $1 AND agent_id = $2 ORDER BY created_at ASC',
    [companyId, agentId],
  );
  for (const row of res.rows) {
    let content: string;
    try {
      content = decryptField(row.content_enc, encryptionKey);
    } catch {
      continue; // fonte ilegível (chave rotacionada) não derruba o rebuild
    }
    chunks.push(
      ...chunkContent(agentId, `fonte:${row.title}`, content, `fonte-${row.id.slice(0, 8)}`),
    );
  }

  store.replaceNamespace(agentId, chunks, `curada-${res.rows.length}f`);
  return { chunkCount: chunks.length, sourceCount: res.rows.length };
}

/** Rebuild de TODOS os conselheiros DE UMA EMPRESA (boot/1º acesso). Falha de um não trava os demais. */
export async function rebuildAllKnowledge(
  store: NamespacedKnowledgeStore,
  db: SqlExecutor,
  companyId: string,
  encryptionKey: Buffer,
  agentIds: readonly AgentId[],
): Promise<void> {
  for (const agentId of agentIds) {
    try {
      await rebuildAgentKnowledge(store, db, companyId, agentId, encryptionKey);
    } catch (error) {
      console.error(`[kb] rebuild do agente ${agentId} (empresa ${companyId}) falhou:`, error);
    }
  }
}
