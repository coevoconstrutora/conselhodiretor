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
      headers: { 'user-agent': 'ConselhoKB/1.0 (+ingestao-de-conhecimento)' },
      redirect: 'follow',
    });
  } catch (err) {
    throw new Error(
      `Não foi possível acessar a URL: ${err instanceof Error && err.name === 'AbortError' ? 'tempo esgotado (20s)' : 'falha de rede'}.`,
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
  input: { kind: KbSourceKind; title: string; ref?: string | null; content: string },
  encryptionKey: Buffer,
): Promise<string> {
  const content = input.content.trim().slice(0, MAX_SOURCE_CHARS);
  if (content.length < 20) throw new Error('Conteúdo curto demais para virar conhecimento.');
  const { originId } = await auditedClinicalWrite(
    db,
    { triggeredBy: `kb-source-add-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      const res = await tx.query<{ id: string }>(
        'INSERT INTO kb_source (company_id, agent_id, kind, title, ref, content_enc) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [
          companyId,
          agentId,
          input.kind,
          input.title.trim().slice(0, 160) || 'Sem título',
          input.ref ?? null,
          encryptField(content, encryptionKey),
        ],
      );
      return res.rows[0]!.id;
    },
  );
  return originId;
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
  }>(
    'SELECT id, kind, title, ref, content_enc, created_at FROM kb_source WHERE company_id = $1 AND agent_id = $2 ORDER BY created_at DESC',
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
    };
  });
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

export async function saveAgentProfile(
  db: SqlExecutor,
  companyId: string,
  agentId: AgentId,
  displayName: string,
  scope: string,
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: `agent-profile-edit-${agentId}`, kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO agent_profile (company_id, agent_id, display_name, scope) VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, agent_id) DO UPDATE
           SET display_name = EXCLUDED.display_name, scope = EXCLUDED.scope, updated_at = now()`,
        [companyId, agentId, displayName.trim().slice(0, 80), scope.trim().slice(0, 600)],
      );
      return null; // agent_profile não tem id próprio (PK é company_id+agent_id, ambos não-uuid)
    },
  );
  applyAgentProfileOverrides(companyId, [{ agentId, displayName, scope }]);
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
  scope: string,
  triggerKeywords: readonly string[],
): Promise<AgentId> {
  const name = displayName.trim().slice(0, 80);
  const scopeText = scope.trim().slice(0, 600);
  if (name.length < 3) throw new Error('O nome precisa de pelo menos 3 caracteres.');
  if (scopeText.length < 20) throw new Error('O escopo precisa ter pelo menos 20 caracteres.');
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
        `INSERT INTO agent_profile (company_id, agent_id, display_name, scope, trigger_keywords)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, agentId, name, scopeText, keywords],
      );
      return null;
    },
  );
  applyAgentProfileOverrides(companyId, [{ agentId: agentId as AgentId, displayName: name, scope: scopeText }]);
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
  const res = await db.query<{ agent_id: string; display_name: string; scope: string }>(
    'SELECT agent_id, display_name, scope FROM agent_profile WHERE company_id = $1',
    [companyId],
  );
  applyAgentProfileOverrides(
    companyId,
    res.rows.map((r) => ({
      agentId: r.agent_id as AgentId,
      displayName: r.display_name,
      scope: r.scope,
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
