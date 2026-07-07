import type { IKnowledgeRetriever, KbChunk, AgentId } from '@conselho/providers';

/**
 * Knowledge Store com NAMESPACES ISOLADOS por persona (Story 5.1 — FR21, ADR-004).
 *
 * Implementação real de `IKnowledgeRetriever`: `retrieve(agentId, query, k)`
 * busca EXCLUSIVAMENTE no namespace daquela persona — o cardiologista nunca
 * recebe chunk de endocrinologia (T6). Ranking lexical determinístico
 * (sobreposição de termos normalizados); trocar por vector store com
 * embeddings é OUTRA implementação da MESMA interface (NFR8/ADR-002) — o
 * domínio não muda.
 */

export class NamespacedKnowledgeStore implements IKnowledgeRetriever {
  private readonly namespaces = new Map<AgentId, KbChunk[]>();
  /** Versão de ingestão por namespace (Story 5.2). */
  private readonly versions = new Map<AgentId, string>();

  /** SUBSTITUI o conteúdo do namespace (re-ingestão — R8, sem resíduo). */
  replaceNamespace(agentId: AgentId, chunks: readonly KbChunk[], version: string): void {
    const foreign = chunks.find((c) => c.agentId !== agentId);
    if (foreign) {
      throw new Error(
        `Chunk ${foreign.id} pertence a ${foreign.agentId} — não pode entrar no namespace ${agentId} (FR21).`,
      );
    }
    this.namespaces.set(agentId, [...chunks]);
    this.versions.set(agentId, version);
  }

  versionOf(agentId: AgentId): string | undefined {
    return this.versions.get(agentId);
  }

  sizeOf(agentId: AgentId): number {
    return this.namespaces.get(agentId)?.length ?? 0;
  }

  async retrieve(agentId: AgentId, query: string, k: number): Promise<KbChunk[]> {
    const chunks = this.namespaces.get(agentId) ?? []; // SÓ este namespace (FR21)
    const queryTerms = tokenize(query);
    if (queryTerms.size === 0 || k <= 0) return [];
    return chunks
      .map((chunk) => ({ chunk, score: overlapScore(queryTerms, tokenize(chunk.text)) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, k)
      .map(({ chunk, score }) => ({ ...chunk, score }));
  }
}

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'que', 'com', 'por', 'para', 'se', 'ao', 'à', 'é', 'são', 'sobre', 'mais',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos p/ casar variações
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function overlapScore(query: Set<string>, doc: Set<string>): number {
  let hits = 0;
  for (const term of query) if (doc.has(term)) hits += 1;
  return hits / Math.max(query.size, 1);
}
