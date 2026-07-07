import type { ContributionSeverity, ContributionType, AgentId } from '@conselho/providers';
import type { TriggerMatch } from './triggers';

/**
 * Guarda-corpos lógicos do board no SERVIDOR (Stories 4.2–4.5 — ADR-008):
 * Scorer+limiar (NFR1), rate-limit por agente (e global) com fila e ⚠️ fura-fila (NFR2),
 * dedup/consolidação (FR11) e gating de pausa natural (FR12).
 *
 * Tudo determinístico e barato — roda ANTES do LLM (T2). O Reasoner (E5) só é
 * chamado para candidatos LIBERADOS. Defaults configuráveis; calibração fina
 * com dados reais é E10.
 */

export interface Candidate {
  readonly id: string;
  readonly agentId: AgentId;
  /** Personas consolidadas (FR11) — inclui a própria; >1 ⇒ card consolidado. */
  readonly agentIds: readonly AgentId[];
  readonly triggerId: string;
  /** Chave de tópico p/ dedup (gatilho normalizado). */
  readonly topicKey: string;
  readonly type: ContributionType;
  readonly severity: ContributionSeverity;
  readonly score: number;
  readonly segmentText: string;
  readonly at: number;
}

// ---------------------------------------------------------------------------
// Story 4.2 — Relevance Scorer + Gate (NFR1)
// ---------------------------------------------------------------------------

export interface ScorerConfig {
  /** Limiar p/ não-críticos (default 0.6). */
  readonly threshold?: number;
  /** Limiar p/ ⚠️ críticos — menor: recall > precisão (default 0.3). */
  readonly criticalThreshold?: number;
}

/** Score barato: peso do gatilho + densidade de termos clínicos no segmento. */
export function scoreMatch(match: TriggerMatch): number {
  const base = match.trigger.baseWeight;
  // densidade: segmentos curtos e diretos pontuam mais que falas longas difusas
  const words = match.segmentText.split(/\s+/).length;
  const density = Math.min(1, 12 / Math.max(words, 1));
  return Math.min(1, base * 0.8 + density * 0.2);
}

export class RelevanceGate {
  private readonly threshold: number;
  private readonly criticalThreshold: number;

  constructor(config: ScorerConfig = {}) {
    this.threshold = config.threshold ?? 0.6;
    this.criticalThreshold = config.criticalThreshold ?? 0.3;
  }

  passes(score: number, severity: ContributionSeverity): boolean {
    return score >= (severity === 'critical' ? this.criticalThreshold : this.threshold);
  }
}

// ---------------------------------------------------------------------------
// Story 4.3 — Rate-limit por agente + teto GLOBAL do board + fila de prioridade
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  /** Teto de contribuições NÃO-críticas por minuto, POR agente (default 1 — 8 conselheiros). */
  readonly maxPerMinutePerAgent?: number;
  /** Teto GLOBAL de não-críticas por minuto no board inteiro (default 4). */
  readonly maxPerMinuteGlobal?: number;
  readonly windowMs?: number;
}

export class AgentRateLimiter {
  private readonly max: number;
  private readonly maxGlobal: number;
  private readonly windowMs: number;
  private readonly delivered = new Map<AgentId, number[]>();
  private globalDelivered: number[] = [];

  constructor(config: RateLimiterConfig = {}) {
    this.max = config.maxPerMinutePerAgent ?? 1;
    this.maxGlobal = config.maxPerMinuteGlobal ?? 4;
    this.windowMs = config.windowMs ?? 60_000;
  }

  /** ⚠️ críticos sempre passam e NÃO contam nos tetos. */
  allow(agentId: AgentId, severity: ContributionSeverity, now: number): boolean {
    if (severity === 'critical') return true;
    const times = (this.delivered.get(agentId) ?? []).filter((t) => now - t < this.windowMs);
    this.globalDelivered = this.globalDelivered.filter((t) => now - t < this.windowMs);
    // teto global do board: com 8 conselheiros ativos, o limite por agente
    // sozinho ainda permitiria 8 cards/min — ruído demais numa reunião.
    if (times.length >= this.max || this.globalDelivered.length >= this.maxGlobal) {
      this.delivered.set(agentId, times);
      return false;
    }
    times.push(now);
    this.delivered.set(agentId, times);
    this.globalDelivered.push(now);
    return true;
  }
}

/** Fila de prioridade p/ excedentes: severidade > score > ordem de chegada. */
export class PriorityQueue {
  private items: Candidate[] = [];

  enqueue(candidate: Candidate): void {
    // redundância na fila é descartada (NFR2): mesmo tópico+persona não duplica
    if (this.items.some((c) => c.topicKey === candidate.topicKey && c.agentId === candidate.agentId)) return;
    this.items.push(candidate);
    this.items.sort(
      (a, b) =>
        Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
        b.score - a.score ||
        a.at - b.at,
    );
  }

  dequeue(): Candidate | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }
}

// ---------------------------------------------------------------------------
// Story 4.4 — Deduplicação / consolidação (FR11)
// ---------------------------------------------------------------------------

export interface DedupConfig {
  readonly windowMs?: number;
}

export type DedupResult =
  | { kind: 'fresh'; candidate: Candidate }
  | { kind: 'consolidated'; candidate: Candidate }
  | { kind: 'duplicate' };

export class Deduplicator {
  private readonly windowMs: number;
  private readonly seen = new Map<string, Candidate>();

  constructor(config: DedupConfig = {}) {
    this.windowMs = config.windowMs ?? 60_000;
  }

  submit(candidate: Candidate): DedupResult {
    const previous = this.seen.get(candidate.topicKey);
    if (previous && candidate.at - previous.at < this.windowMs) {
      if (previous.agentIds.includes(candidate.agentId)) {
        return { kind: 'duplicate' }; // mesma persona repetindo o tópico
      }
      // personas diferentes no mesmo tópico → consolida em 1 (FR11)
      const consolidated: Candidate = {
        ...previous,
        agentIds: [...previous.agentIds, candidate.agentId],
        score: Math.max(previous.score, candidate.score),
        severity: previous.severity === 'critical' || candidate.severity === 'critical' ? 'critical' : 'normal',
      };
      this.seen.set(candidate.topicKey, consolidated);
      return { kind: 'consolidated', candidate: consolidated };
    }
    this.seen.set(candidate.topicKey, candidate);
    return { kind: 'fresh', candidate };
  }
}

// ---------------------------------------------------------------------------
// Story 4.5 — Gating de pausa natural (FR12 / A4)
// ---------------------------------------------------------------------------

export interface PauseGateConfig {
  /** Silêncio mínimo p/ pausa natural (default 2500ms — frontend-spec A4). */
  readonly pauseMs?: number;
}

export class PauseGate {
  private readonly pauseMs: number;
  private lastSpeechAt = 0;
  private held: Candidate[] = [];

  constructor(config: PauseGateConfig = {}) {
    this.pauseMs = config.pauseMs ?? 2500;
  }

  /** Alimentado por todo segmento FINAL da sessão (2.3). */
  onSpeech(at: number): void {
    this.lastSpeechAt = at;
  }

  /**
   * ⚠️ críticos passam IMEDIATAMENTE; não-críticos só passam se a conversa
   * está em pausa natural — senão ficam retidos até o próximo flush (FR12).
   */
  submit(candidate: Candidate, now: number): Candidate | null {
    if (candidate.severity === 'critical') return candidate;
    if (now - this.lastSpeechAt >= this.pauseMs) return candidate;
    this.held.push(candidate);
    return null;
  }

  /** Em pausa natural, libera os retidos em ordem de prioridade. */
  flushIfPaused(now: number): Candidate[] {
    if (now - this.lastSpeechAt < this.pauseMs || this.held.length === 0) return [];
    const released = [...this.held].sort(
      (a, b) =>
        Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
        b.score - a.score ||
        a.at - b.at,
    );
    this.held = [];
    return released;
  }

  get heldCount(): number {
    return this.held.length;
  }
}

// ---------------------------------------------------------------------------
// Pipeline composto — a ordem dos guarda-corpos (E4)
// ---------------------------------------------------------------------------

export interface GatekeeperConfig extends ScorerConfig, RateLimiterConfig, DedupConfig, PauseGateConfig {}

export type GateDecision =
  | { kind: 'deliver'; candidate: Candidate }
  | { kind: 'rejected-score' }
  | { kind: 'duplicate' }
  | { kind: 'held-for-pause' }
  | { kind: 'rate-limited' };

/**
 * Composição: score (4.2) → dedup/consolidação (4.4) → pausa (4.5) → rate-limit (4.3).
 * Só o que sai como `deliver` segue para o Persona Reasoner (E5) — LLM nunca
 * roda para candidato rejeitado (T2).
 */
export class BoardGatekeeper {
  readonly relevance: RelevanceGate;
  readonly rateLimiter: AgentRateLimiter;
  readonly deduplicator: Deduplicator;
  readonly pauseGate: PauseGate;
  readonly queue = new PriorityQueue();

  constructor(config: GatekeeperConfig = {}) {
    this.relevance = new RelevanceGate(config);
    this.rateLimiter = new AgentRateLimiter(config);
    this.deduplicator = new Deduplicator(config);
    this.pauseGate = new PauseGate(config);
  }

  submit(candidate: Candidate, now: number): GateDecision {
    if (!this.relevance.passes(candidate.score, candidate.severity)) return { kind: 'rejected-score' };

    const dedup = this.deduplicator.submit(candidate);
    if (dedup.kind === 'duplicate') return { kind: 'duplicate' };
    const current = dedup.candidate;

    const released = this.pauseGate.submit(current, now);
    if (!released) return { kind: 'held-for-pause' };

    if (!this.rateLimiter.allow(released.agentId, released.severity, now)) {
      this.queue.enqueue(released);
      return { kind: 'rate-limited' };
    }
    return { kind: 'deliver', candidate: released };
  }

  /** Chamar periodicamente/em pausas: libera retidos e drena a fila dentro do teto. */
  release(now: number): Candidate[] {
    const out: Candidate[] = [];
    for (const candidate of this.pauseGate.flushIfPaused(now)) {
      if (this.rateLimiter.allow(candidate.agentId, candidate.severity, now)) out.push(candidate);
      else this.queue.enqueue(candidate);
    }
    while (this.queue.size > 0) {
      const next = this.queue.dequeue()!;
      if (this.rateLimiter.allow(next.agentId, next.severity, now)) out.push(next);
      else {
        this.queue.enqueue(next);
        break;
      }
    }
    return out;
  }
}
