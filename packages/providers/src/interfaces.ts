/**
 * As 4 interfaces de abstração de fornecedores (NFR8, ADR-002) — architecture §5.
 *
 * O domínio importa SÓ estes contratos; vendors concretos (E2/E5/E8) os
 * implementam depois, sem refatorar o domínio. Mínimos por design (AC6):
 * Fase 2 (TTS) e Fase 3 (avatar interativo) entram como novas implementações.
 */
import type {
  AgentId,
  VideoState,
  TranscriptSegment,
  KbChunk,
  AgentContribution,
  ClipRef,
} from './types';

/**
 * Sessão de STT em streaming: itera segmentos parciais/finais conforme chegam.
 * `close()` encerra a sessão e libera recursos do provider.
 */
export interface SttSession extends AsyncIterable<TranscriptSegment> {
  close(): Promise<void>;
}

/**
 * Opções de abertura do stream (extensão ADITIVA — Stories 2.1/2.6, sem quebrar
 * consumidores que passam só `{ lang }`):
 * - `audio`: fonte de áudio bruto (Story 2.2 entrega; fakes ignoram).
 * - `vocabularyBoost`: termos clínicos a reforçar quando o vendor suportar (T4).
 */
export interface SttOpenOptions {
  readonly lang: 'pt-BR';
  readonly audio?: AsyncIterable<Uint8Array>;
  readonly vocabularyBoost?: readonly string[];
}

/** Speech-to-Text em streaming PT-BR (§5). */
export interface ISttProvider {
  openStream(opts: SttOpenOptions): SttSession;
}

/** Requisição de completon do LLM para gerar uma contribuição de persona. */
export interface LlmCompletionRequest {
  readonly system: string;
  readonly context: readonly KbChunk[];
  readonly transcript: string;
  /**
   * ADITIVO (B1 — anti-repetição): contribuições JÁ exibidas nesta consulta,
   * formatadas ("[Dr. Paulo] texto"). O modelo é instruído a não repeti-las.
   */
  readonly priorContributions?: readonly string[];
  /** ADITIVO (B1): autoriza o modelo a responder {"skip":true} quando não há nada novo. */
  readonly allowSkip?: boolean;
  /**
   * Configuração INDIVIDUAL do conselheiro (Etapa "IA por conselheiro") —
   * sobrepõe o modelo/esforço de raciocínio default do provider PARA ESTA
   * chamada. `undefined` ⇒ o provider usa o próprio default. Só o adapter
   * OpenAI lê estes campos hoje (Gemini/Anthropic ignoram, sem quebrar).
   */
  readonly model?: string;
  readonly reasoningEffort?: string;
}

/** Requisição de completion de TEXTO LIVRE (uso interno — não vira card do board). */
export interface TextCompletionRequest {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  /**
   * Override de modelo/esforço PARA ESTA chamada (Configuração do Presidente
   * — modelo de acompanhamento) — mesmo mecanismo de `LlmCompletionRequest`.
   * `undefined` ⇒ o provider usa o próprio default.
   */
  readonly model?: string;
  readonly reasoningEffort?: string;
}

/** LLM que produz a contribuição de uma persona a partir do contexto recuperado. */
export interface ILlmProvider {
  complete(req: LlmCompletionRequest): Promise<AgentContribution>;
  /**
   * ADITIVO/OPCIONAL (B3): completion de texto livre para usos internos
   * (CaseState, case review). Implementações antigas/fakes sem este método
   * continuam válidas — consumidores DEVEM degradar graciosamente.
   */
  completeText?(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }>;
}

/**
 * Recuperação de conhecimento escopada por persona (FR21): retorna SÓ chunks do
 * namespace daquela persona — impede uma persona de "invadir" outra especialidade.
 */
export interface IKnowledgeRetriever {
  retrieve(agentId: AgentId, query: string, k: number): Promise<KbChunk[]>;
}

/**
 * Catálogo de vídeo pré-renderizado (ADR-007): retorna o clipe para (persona, estado).
 * NÃO é streaming de avatar em tempo real (isso seria Fase 3 — AC6).
 */
export interface IVideoAssetProvider {
  getClip(agentId: AgentId, state: VideoState): ClipRef;
}
