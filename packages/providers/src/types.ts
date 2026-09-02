/**
 * Tipos de domínio dos contratos de fornecedores (architecture.md §5/§8).
 *
 * São os tipos que o domínio (E2/E5/E8) troca com os providers, SEM conhecer
 * nenhum vendor concreto (NFR8). Mantidos mínimos e fiéis à arquitetura
 * (Article IV — No Invention): nada de TTS/streaming de vídeo/batch aqui.
 */

/**
 * Slug de um conselheiro. Toda empresa começa com os 9 padrão
 * (docs/agents-knowledge-seed.md), mas pode CRIAR conselheiros próprios
 * além desses — por isso `string`, não um union fechado. O universo real
 * por empresa vive em `agent_profile` (banco), nunca só no código.
 * `DEFAULT_AGENT_IDS`/`DEFAULT_COUNSELOR_AGENT_IDS` abaixo são só os 9
 * padrão, usados pra semear empresa nova — não são "os únicos válidos".
 */
export type AgentId = string;

/** Id reservado do sintetizador — nunca é um "participante" comum. */
export const PRESIDENT_AGENT_ID = 'presidente';

/** Os 9 conselheiros padrão, na ordem de exibição — semente de empresa nova. */
export const DEFAULT_AGENT_IDS: readonly AgentId[] = [
  'engenharia', // Engenharia e Lean Construction
  'vendas', // Vendas e Marketing
  'mercado', // Inteligência de Mercado e Produto
  'arquitetura', // Arquitetura e Urbanismo
  'legal', // Legal e Compliance
  'cs', // Customer Success e Pós-venda
  'cfo', // CFO, Funding, Caixa e MCMV
  'futurista', // Futurista
  PRESIDENT_AGENT_ID, // Presidente do Conselho (sintetizador)
];

/** Os 8 conselheiros padrão que CONTRIBUEM (o presidente só sintetiza). */
export const DEFAULT_COUNSELOR_AGENT_IDS: readonly AgentId[] = DEFAULT_AGENT_IDS.filter(
  (id) => id !== PRESIDENT_AGENT_ID,
);

/** @deprecated use `DEFAULT_AGENT_IDS` — nome antigo sugeria ser a lista COMPLETA (não é mais). */
export const ALL_AGENT_IDS = DEFAULT_AGENT_IDS;
/** @deprecated use `DEFAULT_COUNSELOR_AGENT_IDS`. */
export const COUNSELOR_AGENT_IDS = DEFAULT_COUNSELOR_AGENT_IDS;

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
/** Urgência da contribuição (Etapa "Orquestração" — schema estruturado, aditivo). */
export type ContributionUrgency = 'low' | 'medium' | 'high' | 'critical';

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
  /**
   * Schema estruturado (Etapa "Orquestração") — todos ADITIVOS/opcionais,
   * ausência nunca quebra o parsing de uma resposta no formato antigo.
   */
  readonly urgency?: ContributionUrgency;
  /** Categoria curta e livre (ex.: "financial_risk") — curadoria futura, não é enum fechado ainda. */
  readonly category?: string;
  /** Título curto do card — a UI usa como manchete, caindo no início de `text` quando ausente. */
  readonly headline?: string;
  readonly recommendation?: string;
  readonly question?: string;
  /** Sinaliza um evento crítico configurado para interromper a reunião (Etapa "voz sob demanda", ainda não ligada na UI). */
  readonly requiresImmediateInterruption?: boolean;
}

/** Referência a um clipe pré-renderizado do catálogo de vídeo (ADR-007). */
export interface ClipRef {
  readonly agentId: AgentId;
  readonly state: VideoState;
  readonly url: string;
}
