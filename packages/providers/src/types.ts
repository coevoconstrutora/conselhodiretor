/**
 * Tipos de domínio dos contratos de fornecedores (architecture.md §5/§8).
 *
 * São os tipos que o domínio (E2/E5/E8) troca com os providers, SEM conhecer
 * nenhum vendor concreto (NFR8). Mantidos mínimos e fiéis à arquitetura
 * (Article IV — No Invention): nada de TTS/streaming de vídeo/batch aqui.
 */

/** Os 9 agentes do Conselho (docs/agents-knowledge-seed.md). */
export type AgentId =
  | 'engenharia' // Engenharia e Lean Construction
  | 'vendas' // Vendas e Marketing
  | 'mercado' // Inteligência de Mercado e Produto
  | 'arquitetura' // Arquitetura e Urbanismo
  | 'legal' // Legal e Compliance
  | 'cs' // Customer Success e Pós-venda
  | 'cfo' // CFO, Funding, Caixa e MCMV
  | 'futurista' // Futurista
  | 'presidente'; // Presidente do Conselho (sintetizador)

/** Lista canônica de todos os agentes, na ordem de exibição. */
export const ALL_AGENT_IDS: readonly AgentId[] = [
  'engenharia',
  'vendas',
  'mercado',
  'arquitetura',
  'legal',
  'cs',
  'cfo',
  'futurista',
  'presidente',
];

/** Conselheiros que CONTRIBUEM durante a reunião (o presidente só sintetiza). */
export const COUNSELOR_AGENT_IDS: readonly AgentId[] = ALL_AGENT_IDS.filter(
  (id) => id !== 'presidente',
);

/** Tipo de contribuição da persona (CONTRIBUTION.type — §8). */
export type ContributionType = 'atencao' | 'sugestao' | 'hipotese' | 'sintese';

/** Severidade da contribuição (CONTRIBUTION.severity — §8). */
export type ContributionSeverity = 'normal' | 'critical';

/** Estado de vídeo do catálogo pré-renderizado (ADR-007, §5). */
export type VideoState = 'ouvindo' | 'pensando' | 'sinalizando';

/**
 * Segmento de transcrição emitido pelo STT em streaming (§5).
 * `isFinal=false` ⇒ parcial (pode ser revisado); `true` ⇒ consolidado.
 */
export interface TranscriptSegment {
  readonly text: string;
  readonly isFinal: boolean;
  /** Offsets opcionais em ms desde o início do stream. */
  readonly startMs?: number;
  readonly endMs?: number;
  /** Epoch ms de recepção no cliente — insumo de medição de latência (NFR5, POC 2.5). */
  readonly receivedAtMs?: number;
}

/**
 * Trecho de conhecimento recuperado da KB, sempre escopado por persona (FR21).
 * `source` sustenta a proveniência da auditoria (NFR10 → Story 1.5).
 */
export interface KbChunk {
  readonly id: string;
  readonly agentId: AgentId;
  readonly text: string;
  readonly source?: string;
  readonly score?: number;
}

/**
 * Contribuição de uma persona, produzida pelo LLM (alinha com CONTRIBUTION §8).
 * Campos de proveniência (`triggeredBy`, `kbSources`) alimentam a auditoria.
 */
export interface AgentContribution {
  readonly agentId: AgentId;
  readonly type: ContributionType;
  readonly severity: ContributionSeverity;
  readonly text: string;
  readonly relevanceScore?: number;
  readonly triggeredBy?: string;
  /** Ids dos KbChunk usados como base (proveniência para auditoria). */
  readonly kbSources?: readonly string[];
  /** Versão do modelo que gerou (proveniência NFR10 — Story 1.5). */
  readonly modelVersion?: string;
  /**
   * ADITIVO (B1): o modelo declarou não ter nada NOVO a acrescentar. Quando
   * true, os demais campos são placeholder — o orchestrator descarta sem exibir.
   */
  readonly skip?: true;
}

/** Referência a um clipe pré-renderizado do catálogo de vídeo (ADR-007). */
export interface ClipRef {
  readonly agentId: AgentId;
  readonly state: VideoState;
  readonly url: string;
}
