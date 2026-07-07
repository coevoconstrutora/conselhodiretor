import type { KbChunk, AgentId } from '@conselho/providers';
import type { NamespacedKnowledgeStore } from './store';

/**
 * Pipeline de ingestão VERSIONADO (Story 5.2 — R8, ADR-004).
 *
 * Ingere documentos markdown por persona, gerando chunks com PROVENIÊNCIA
 * (fonte + versão no `source`) — é o que alimenta `kbSources` da contribuição
 * e, por ela, a trilha de auditoria (NFR10/1.5).
 *
 * R8: substituir a semente pela base curada = chamar `ingest` de novo com a
 * nova fonte/versão — o namespace é SUBSTITUÍDO, zero mudança de código.
 */

export interface IngestSource {
  readonly agentId: AgentId;
  /** Identificador da fonte (ex.: 'personas-knowledge-base-seed.md#paulo'). */
  readonly source: string;
  /** Markdown/texto do conteúdo da persona. */
  readonly content: string;
}

export interface IngestResult {
  readonly agentId: AgentId;
  readonly version: string;
  readonly chunkCount: number;
}

/**
 * Chunker simples: blocos por linha significativa (bullets/parágrafos),
 * ignorando cabeçalhos vazios. Curadoria real pode trazer chunkers melhores —
 * mesma interface.
 */
export function chunkContent(agentId: AgentId, source: string, content: string, version: string): KbChunk[] {
  const lines = content
    .split('\n')
    .map((l) => l.replace(/^[-*>\s#]+/, '').trim())
    .filter((l) => l.length >= 20); // descarta títulos/ruído curto
  return lines.map((text, i) => ({
    id: `${agentId}:${version}:${i}`,
    agentId,
    text,
    source: `${source}@${version}`, // proveniência: fonte + versão (NFR10)
  }));
}

/** Ingere (ou RE-ingere) as fontes no store, substituindo cada namespace. */
export function ingest(
  store: NamespacedKnowledgeStore,
  sources: readonly IngestSource[],
  version: string,
): IngestResult[] {
  const results: IngestResult[] = [];
  for (const src of sources) {
    const chunks = chunkContent(src.agentId, src.source, src.content, version);
    store.replaceNamespace(src.agentId, chunks, version);
    results.push({ agentId: src.agentId, version, chunkCount: chunks.length });
  }
  return results;
}

/**
 * Extrai as seções por agente da SEMENTE (`docs/agents-knowledge-seed.md`).
 * Cada seção começa com `## <slug>` (ex.: `## cfo`). O presidente não tem
 * seção — ele sintetiza, não recupera KB própria.
 * ⚠️ A semente é conteúdo inicial de referência — o empresário/especialistas
 * devem enriquecê-la; substituir = re-ingestão com nova versão (sem código).
 */
export function seedSources(seedMarkdown: string): IngestSource[] {
  const slugs: readonly AgentId[] = [
    'engenharia',
    'vendas',
    'mercado',
    'arquitetura',
    'legal',
    'cs',
    'cfo',
    'futurista',
  ];
  const sources: IngestSource[] = [];
  for (const agentId of slugs) {
    const marker = new RegExp(`## ${agentId}\\b[\\s\\S]*?(?=\\n## |$)`);
    const match = marker.exec(seedMarkdown);
    if (match) {
      sources.push({
        agentId,
        source: `agents-knowledge-seed.md#${agentId}`,
        content: match[0],
      });
    }
  }
  return sources;
}
