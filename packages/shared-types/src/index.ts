/**
 * Tipos compartilhados entre frontend (apps/web) e serviços de domínio (packages/*).
 * Prova de coerência de linguagem e reaproveitamento de tipos do monorepo (ADR-001).
 */

export interface AppInfo {
  readonly name: string;
  readonly version: string;
}

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthReport {
  readonly status: HealthStatus;
  readonly app: AppInfo;
}

// ---------------------------------------------------------------------------
// Protocolo do canal de eventos do board (ADR-003 — Story 3.2)
// Versionado: consumidores devem ignorar mensagens com `v` desconhecido.
// O canal NÃO transporta áudio (architecture §7) — só eventos do board.
// ---------------------------------------------------------------------------

export const BOARD_PROTOCOL_VERSION = 1 as const;

/**
 * Slug do agente (espelho de AgentId em @conselho/providers). Cada empresa
 * pode ter conselheiros CUSTOM além dos 9 padrão — por isso é `string`, não
 * um union fechado; o id em si vem sempre do banco (agent_profile), nunca
 * inventado no cliente.
 */
export type WireAgentId = string;

/** Contribuição como trafega no fio (espelho serializável de AgentContribution). */
export interface WireContribution {
  readonly agentId: WireAgentId;
  readonly type: 'atencao' | 'sugestao' | 'hipotese' | 'sintese';
  readonly severity: 'normal' | 'critical';
  readonly text: string;
  readonly relevanceScore?: number;
}

export type BoardServerMessage =
  | {
      readonly v: typeof BOARD_PROTOCOL_VERSION;
      readonly type: 'contribution';
      readonly id: string;
      readonly meetingId: string;
      readonly triggeredBy: string;
      readonly at: number;
      readonly contribution: WireContribution;
      /** Personas do card (>1 = consolidado — FR11). Aditivo (E6). */
      readonly agentIds?: readonly string[];
      /** Divergência transparente (FR7). Aditivo (E6). */
      readonly divergent?: boolean;
    }
  | { readonly v: typeof BOARD_PROTOCOL_VERSION; readonly type: 'ping'; readonly at: number }
  | {
      /** Transcrição ao vivo p/ o painel (aditivo — E7). NÃO é áudio (§7). */
      readonly v: typeof BOARD_PROTOCOL_VERSION;
      readonly type: 'transcript';
      readonly text: string;
      readonly isFinal: boolean;
      readonly at: number;
    }
  | {
      /** Status do pipeline de transcrição (aditivo — A3): espelha SessionStatus.
       * `degraded` = STT caiu e está em retry; a UI deve tornar isso VISÍVEL. */
      readonly v: typeof BOARD_PROTOCOL_VERSION;
      readonly type: 'status';
      readonly stt: 'live' | 'degraded' | 'ended';
      readonly lastFinalAt: number | null;
      readonly at: number;
    };

/** Mensagens cliente→servidor (skeleton: só pong; comandos silenciar/foco são E7). */
export type BoardClientMessage = {
  readonly v: typeof BOARD_PROTOCOL_VERSION;
  readonly type: 'pong';
  readonly at: number;
};
