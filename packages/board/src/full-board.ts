import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '@conselho/db';
import { writeAudit } from '@conselho/audit';
import type { ILlmProvider, AgentContribution, AgentId } from '@conselho/providers';
import type { MeetingSession } from '@conselho/session';
import {
  TriggerDetector,
  scoreMatch,
  BoardGatekeeper,
  SemanticDeduplicator,
  keywordSet,
  jaccard,
  type Candidate,
  type GatekeeperConfig,
  type TriggerMatch,
} from '@conselho/engines';
import { AgentReasoner, AGENT_PROFILES, buildAgentSystem } from '@conselho/kb';
import type { IKnowledgeRetriever } from '@conselho/providers';
import { CaseStateTracker } from './case-state';
import { CASE_REVIEW_SYSTEM, parseCaseReview } from './case-review';

/**
 * Conselho COMPLETO: os 8 conselheiros simultâneos integrando motores de
 * gating e RAG, com síntese do Presidente do Conselho e divergência
 * transparente entre especialidades.
 *
 * Pipeline por segmento FINAL: TriggerDetector → score → BoardGatekeeper
 * (limiar/dedup/pausa/rate-limit por agente + global) → AgentReasoner (KB
 * escopada) → auditoria → evento. LLM SÓ roda para candidato liberado.
 */

/** Evento-base de contribuição (contrato consumido pelo gateway WS). */
export interface BoardContributionEvent {
  readonly type: 'contribution';
  readonly id: string;
  readonly meetingId: string;
  readonly contribution: AgentContribution;
  readonly triggeredBy: string;
  readonly at: number;
}

export interface FullBoardEvent extends BoardContributionEvent {
  /** Agentes do card (>1 ⇒ consolidado). */
  readonly agentIds: readonly AgentId[];
  /** Divergência transparente entre agentes no mesmo tópico. */
  readonly divergent: boolean;
}

export type FullBoardListener = (event: FullBoardEvent) => void;

export interface FullBoardConfig extends GatekeeperConfig {
  /** Intervalo do tick de release (pausa/fila). Default 1000ms. */
  readonly tickMs?: number;
  /** Síntese automática: contribuições mínimas de personas distintas (default 2). */
  readonly synthesisMinPersonas?: number;
  /** Silêncio p/ síntese automática (default 12s). */
  readonly synthesisQuietMs?: number;
  readonly now?: () => number;
  /** Telemetria (E10): decisão do gate por candidato (calibração O2/O3). */
  readonly onDecision?: (kind: string) => void;
  /** Telemetria (E10): latência gatilho→publicação por contribuição (§11). */
  readonly onContributionLatency?: (latencyMs: number) => void;
  /** B3: atualiza o CaseState a cada N finais (default 6). */
  readonly caseStateEveryNFinals?: number;
  /** B3: telemetria — update do CaseState concluído. */
  readonly onCaseStateUpdate?: () => void;
  /**
   * B4: intervalo mínimo entre reviews periódicos do caso (só em pausa
   * natural). Default: DESLIGADO. Piloto sugerido: 90_000.
   */
  readonly caseReviewMs?: number;
  /** B4: telemetria — desfecho de cada review. */
  readonly onCaseReview?: (outcome: 'skip' | 'contribution' | 'discarded') => void;
  /**
   * B2: limiar de similaridade (Jaccard) do dedup semântico — ÚNICO ponto de
   * verdade para o corte pré-LLM E pós-LLM (default 0.5). Calibrar com a
   * telemetria "autonomia" do piloto.
   */
  readonly semanticDedupThreshold?: number;
  /**
   * Memória entre reuniões: síntese do Presidente das últimas reuniões
   * ENCERRADAS (board-runtime monta isso antes de instanciar o orchestrator).
   * Prefixa o CaseState em toda chamada — sem isso, cada reunião é uma ilha.
   */
  readonly priorMeetingsContext?: string;
}

/** B2: default do limiar de dedup semântico (compartilhado pré e pós LLM). */
export const DEFAULT_SEMANTIC_DEDUP_THRESHOLD = 0.5;

interface RoundEntry {
  readonly contribution: AgentContribution;
  readonly topicKey: string;
}

export class FullBoardOrchestrator {
  private readonly listeners = new Set<FullBoardListener>();
  private readonly detector = new TriggerDetector();
  private readonly gate: BoardGatekeeper;
  private readonly reasoner: AgentReasoner;
  private readonly recentFinals: string[] = [];
  private readonly round: RoundEntry[] = [];
  /**
   * B1 — memória da reunião INTEIRA (nunca limpa, diferente de `round`):
   * tudo que o board já exibiu, realimentado ao LLM contra repetição.
   */
  private readonly history: { agentId: AgentId; text: string }[] = [];
  /** B2 — pré-LLM: 1º segmento que rendeu contribuição por agente+tópico (reunião inteira). */
  private readonly seenTopics = new Map<string, string>();
  /** B2 — pós-LLM: similaridade contra TODOS os textos já exibidos. */
  private readonly semanticDedup: SemanticDeduplicator;
  /** B2 — limiar único (pré e pós LLM). */
  private readonly semanticDedupThreshold: number;
  /** B3 — memória estruturada do caso (desliga sozinha sem completeText). */
  private readonly caseState: CaseStateTracker;
  /** Memória entre reuniões (síntese das últimas reuniões encerradas). */
  private readonly priorMeetingsContext: string | undefined;
  /** Tipos por tópico p/ detecção de divergência (FR7). */
  private readonly topicTypes = new Map<string, Map<AgentId, string>>();
  private unsubscribe: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastContributionAt = 0;
  /** B4 — case review periódico. */
  private lastSpeechAt = 0;
  private lastCaseReviewAt = 0;
  private caseReviewInFlight = false;
  private caseReviewRun: Promise<void> = Promise.resolve();
  private synthesized = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly config: Required<Pick<FullBoardConfig, 'tickMs' | 'synthesisMinPersonas' | 'synthesisQuietMs'>>;
  private readonly config2: Pick<FullBoardConfig, 'onDecision' | 'onContributionLatency'>;
  private readonly configReview: Pick<FullBoardConfig, 'caseReviewMs' | 'onCaseReview' | 'pauseMs'>;

  constructor(
    private readonly db: SqlExecutor,
    private readonly session: MeetingSession,
    private readonly llm: ILlmProvider,
    retriever: IKnowledgeRetriever,
    config: FullBoardConfig = {},
  ) {
    this.gate = new BoardGatekeeper(config);
    this.reasoner = new AgentReasoner(retriever, llm);
    this.semanticDedupThreshold = config.semanticDedupThreshold ?? DEFAULT_SEMANTIC_DEDUP_THRESHOLD;
    this.semanticDedup = new SemanticDeduplicator({ threshold: this.semanticDedupThreshold });
    this.caseState = new CaseStateTracker(llm, {
      everyNFinals: config.caseStateEveryNFinals,
      onUpdate: config.onCaseStateUpdate,
    });
    this.priorMeetingsContext = config.priorMeetingsContext;
    this.now = config.now ?? Date.now;
    this.config = {
      tickMs: config.tickMs ?? 1000,
      synthesisMinPersonas: config.synthesisMinPersonas ?? 2,
      synthesisQuietMs: config.synthesisQuietMs ?? 12_000,
    };
    this.config2 = { onDecision: config.onDecision, onContributionLatency: config.onContributionLatency };
    this.configReview = {
      caseReviewMs: config.caseReviewMs,
      onCaseReview: config.onCaseReview,
      pauseMs: config.pauseMs,
    };
  }

  /** Liga as 3 personas sobre o stream (FR2) + tick de release/síntese. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.subscribe((event) => {
      if (event.type !== 'segment' || !event.segment.isFinal) return;
      const text = event.segment.text;
      const at = this.now();
      this.gate.pauseGate.onSpeech(at);
      this.lastSpeechAt = at; // B4: review só em pausa natural
      this.pending = this.pending.then(() => this.onFinalSegment(text, at));
    });
    this.ticker = setInterval(() => {
      this.pending = this.pending.then(() => this.tick());
    }, this.config.tickMs);
    this.ticker.unref?.();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.listeners.clear();
  }

  subscribe(listener: FullBoardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  flush(): Promise<void> {
    return this.pending;
  }

  /** CaseState da reunião ATUAL prefixado pela memória de reuniões ANTERIORES. */
  private renderCaseState(): string {
    const current = this.caseState.renderForPrompt();
    if (!this.priorMeetingsContext) return current;
    return current ? `${this.priorMeetingsContext}\n\n${current}` : this.priorMeetingsContext;
  }

  /** Síntese SOB DEMANDA (FR18) — além da automática. */
  async synthesizeNow(): Promise<void> {
    this.pending = this.pending.then(() => this.synthesize('on-demand'));
    return this.pending;
  }

  private async onFinalSegment(text: string, at: number): Promise<void> {
    this.recentFinals.push(text);
    if (this.recentFinals.length > 8) this.recentFinals.shift();
    this.caseState.onFinalSegment(text); // B3: alimenta a memória do caso
    // fire-and-forget: o update roda em paralelo à fala (o tracker impede 2 em voo)
    void this.caseState.maybeUpdate();

    // 3 personas monitoram o MESMO segmento — sem invocação (FR2)
    for (const match of this.detector.detect(text, at)) {
      const candidate = toCandidate(match);
      const decision = this.gate.submit(candidate, at);
      this.config2.onDecision?.(decision.kind);
      if (decision.kind === 'deliver') await this.produce(decision.candidate);
    }
  }

  private async tick(): Promise<void> {
    await this.caseState.maybeUpdate(); // B3: no-op se <N finais ou update em voo
    const now = this.now();
    for (const candidate of this.gate.release(now)) {
      this.config2.onDecision?.('deliver'); // liberado da pausa/fila (E10)
      await this.produce(candidate);
    }
    // síntese automática ao fim da rodada (FR6): atividade + silêncio prolongado
    const distinct = new Set(this.round.map((r) => r.contribution.agentId));
    if (
      !this.synthesized &&
      distinct.size >= this.config.synthesisMinPersonas &&
      this.lastContributionAt > 0 &&
      now - this.lastContributionAt >= this.config.synthesisQuietMs
    ) {
      await this.synthesize('auto');
    }
    // B4 — fire-and-forget: a chamada LLM do review (segundos) NÃO pode
    // bloquear a cadeia `pending` (um trigger critical falado durante o
    // review seria represado). O guard caseReviewInFlight impede 2 em voo.
    this.caseReviewRun = this.maybeCaseReview(now);
  }

  /** Executa um tick imediatamente e aguarda o case review disparado por ele. */
  async tickNow(): Promise<void> {
    this.pending = this.pending.then(() => this.tick());
    await this.pending;
    await this.caseReviewRun;
  }

  /**
   * B4 — case review periódico: em pausa natural, 1 chamada de LLM roteia
   * entre as 3 personas ("alguém tem algo NOVO?") ou skip. O output passa
   * pelos MESMOS guarda-corpos das contribuições (dedup semântico, rate-limit,
   * auditoria) — nada de conduta automática.
   */
  private async maybeCaseReview(now: number): Promise<void> {
    const intervalMs = this.configReview.caseReviewMs;
    if (!intervalMs || typeof this.llm.completeText !== 'function' || this.caseReviewInFlight) return;
    if (this.recentFinals.length === 0) return; // reunião ainda sem fala
    if (now - this.lastSpeechAt < (this.configReview.pauseMs ?? 2500)) return; // fora de pausa
    if (now - this.lastCaseReviewAt < intervalMs) return;
    this.caseReviewInFlight = true;
    this.lastCaseReviewAt = now;
    try {
      const scopes = (Object.values(AGENT_PROFILES) as Array<(typeof AGENT_PROFILES)['cfo']>)
        .map((p) => `- ${p.agentId} (${p.displayName}): ${p.scope}`)
        .join('\n');
      const said = this.history
        .slice(-20)
        .map((h) => `- [${AGENT_PROFILES[h.agentId].displayName}] ${h.text}`)
        .join('\n');
      const caseBlock = this.renderCaseState();
      const res = await this.llm.completeText!({
        system: CASE_REVIEW_SYSTEM,
        prompt:
          `Especialistas e escopos:\n${scopes}\n\n` +
          (caseBlock ? `${caseBlock}\n\n` : '') +
          `Últimas falas:\n${this.recentFinals.slice(-4).join(' ')}\n\n` +
          `O conselho JÁ disse nesta reunião:\n${said || '- (nada ainda)'}`,
        maxTokens: 300,
      });
      const parsed = parseCaseReview(res.text);
      if (!parsed || 'skip' in parsed) {
        this.configReview.onCaseReview?.('skip');
        return;
      }
      if (this.semanticDedup.isDuplicate(parsed.text).duplicate) {
        this.configReview.onCaseReview?.('discarded');
        return;
      }
      if (!this.gate.rateLimiter.allow(parsed.agentId, parsed.severity, now)) {
        this.configReview.onCaseReview?.('discarded');
        return;
      }
      const eventId = randomUUID();
      const topicKey = `case-review-${parsed.agentId}`;
      await writeAudit(this.db, eventId, {
        triggeredBy: 'case-review',
        kbSources: [],
        modelVersion: res.modelVersion ?? 'unknown',
      });
      // consistência com produce(): o review alimenta seenTopics (dedup pré-LLM
      // de reviews futuros no mesmo tópico) e topicTypes (divergência FR7) —
      // antes o caminho do review era cego a ambos.
      this.seenTopics.set(`${parsed.agentId}:${topicKey}`, parsed.text);
      const divergent = this.registerAndCheckDivergence(topicKey, parsed.agentId, parsed.type);
      this.round.push({ contribution: { ...parsed, modelVersion: res.modelVersion }, topicKey });
      this.lastContributionAt = this.now();
      this.synthesized = false;
      this.emit({
        type: 'contribution',
        id: eventId,
        meetingId: this.session.meetingId,
        contribution: { ...parsed, modelVersion: res.modelVersion },
        agentIds: [parsed.agentId],
        divergent,
        triggeredBy: 'case-review',
        at: this.now(),
      });
      this.configReview.onCaseReview?.('contribution');
    } catch {
      // review nunca derruba a reunião — próximo intervalo tenta de novo
    } finally {
      this.caseReviewInFlight = false;
    }
  }

  private async produce(candidate: Candidate): Promise<void> {
    // B2 pré-LLM (economia): mesmo agente+tópico já contribuiu na reunião e o
    // novo segmento NÃO traz vocabulário novo ⇒ nem chama o LLM. `critical`
    // NUNCA é cortado aqui (recall > precisão — o modelo decide via skip).
    const topicSeenKey = `${candidate.agentId}:${candidate.topicKey}`;
    const firstSegment = this.seenTopics.get(topicSeenKey);
    if (firstSegment && candidate.severity !== 'critical') {
      const similarity = jaccard(keywordSet(candidate.segmentText), keywordSet(firstSegment));
      if (similarity >= this.semanticDedupThreshold) {
        this.config2.onDecision?.('semantic-duplicate');
        return;
      }
    }
    try {
      const contribution = await this.reasoner.reason({
        agentId: candidate.agentId,
        query: candidate.segmentText,
        transcript: this.recentFinals.join(' '),
        previousContributions: this.history.slice(-20), // cap de tokens (B1)
        caseState: this.renderCaseState() || undefined, // B3
      });
      if (contribution.skip) {
        // o modelo declarou não ter nada novo — sem audit, sem emit (B1)
        this.config2.onDecision?.('llm-skip');
        return;
      }
      // B2 pós-LLM (garantia): texto gerado similar a QUALQUER já exibido ⇒ descarta
      if (this.semanticDedup.isDuplicate(contribution.text).duplicate) {
        this.config2.onDecision?.('semantic-duplicate');
        return;
      }
      this.seenTopics.set(topicSeenKey, firstSegment ?? candidate.segmentText);
      const divergent = this.registerAndCheckDivergence(candidate.topicKey, candidate.agentId, candidate.type);
      const eventId = randomUUID();
      await writeAudit(this.db, eventId, {
        triggeredBy: candidate.triggerId,
        kbSources: [...(contribution.kbSources ?? [])],
        modelVersion: contribution.modelVersion ?? 'unknown',
      });
      this.round.push({ contribution, topicKey: candidate.topicKey });
      this.lastContributionAt = this.now();
      this.synthesized = false;
      this.emit({
        type: 'contribution',
        id: eventId,
        meetingId: this.session.meetingId,
        contribution: { ...contribution, type: candidate.type, severity: candidate.severity },
        agentIds: candidate.agentIds,
        divergent,
        triggeredBy: candidate.triggerId,
        at: this.now(),
      });
      this.config2.onContributionLatency?.(this.now() - candidate.at);
    } catch {
      // falha de LLM/auditoria não derruba a reunião — candidato é perdido
    }
  }

  /**
   * FR7: tipos conflitantes de personas distintas no mesmo tópico ⇒ divergência.
   * Recebe (topicKey, agentId, type) — chamável tanto pelo caminho keyword
   * (produce) quanto pelo case review, para que nenhum seja cego à divergência.
   */
  private registerAndCheckDivergence(topicKey: string, agentId: AgentId, type: string): boolean {
    const types = this.topicTypes.get(topicKey) ?? new Map<AgentId, string>();
    types.set(agentId, type);
    this.topicTypes.set(topicKey, types);
    const distinctTypes = new Set(types.values());
    return types.size > 1 && distinctTypes.size > 1;
  }

  /** O Presidente do Conselho integra a rodada e devolve a decisão ao empresário. */
  private async synthesize(trigger: 'auto' | 'on-demand'): Promise<void> {
    if (this.round.length === 0) return;
    const entries = [...this.round];
    try {
      const caseBlock = this.renderCaseState(); // render 1× (era 2× na template)
      const summary = entries
        .map((e) => `- ${AGENT_PROFILES[e.contribution.agentId].displayName}: ${e.contribution.text}`)
        .join('\n');
      const synthesis = await this.llm.complete({
        system:
          buildAgentSystem(AGENT_PROFILES.presidente) +
          ' Agora seu papel é o de SÍNTESE: integre as contribuições do conselho abaixo numa recomendação única e curta. ' +
          'Se houver divergência entre os conselheiros, exponha-a com transparência e modere. ' +
          'Termine SEMPRE devolvendo a decisão ao empresário (ex.: "a decisão é sua").',
        context: [],
        // B3: a síntese do Presidente enxerga o caso INTEIRO (antes: só a janela curta)
        transcript: `${caseBlock ? `${caseBlock}\n\n` : ''}Transcrição recente da reunião: ${this.recentFinals.join(' ')}\n\nContribuições do conselho:\n${summary}`,
        // B1: sínteses anteriores + contribuições da consulta inteira — evita
        // síntese repetida e dá ao Presidente a progressão da reunião
        priorContributions: this.history
          .slice(-20)
          .map((h) => `[${AGENT_PROFILES[h.agentId].displayName}] ${h.text}`),
      });
      if (synthesis.skip || !synthesis.text.trim()) {
        // síntese vazia NUNCA vira card/persistência — rodada permanece p/ nova tentativa
        return;
      }
      const kbSources = entries.flatMap((e) => e.contribution.kbSources ?? []);
      const eventId = randomUUID();
      await writeAudit(this.db, eventId, {
        triggeredBy: `sintese-${trigger}`,
        kbSources: [...new Set(kbSources)],
        modelVersion: synthesis.modelVersion ?? 'unknown',
      });
      this.round.length = 0; // rodada fecha com a síntese
      this.synthesized = true;
      this.emit({
        type: 'contribution',
        id: eventId,
        meetingId: this.session.meetingId,
        contribution: { ...synthesis, agentId: 'presidente', type: 'sintese', severity: 'normal' },
        agentIds: ['presidente'],
        divergent: false,
        triggeredBy: `sintese-${trigger}`,
        at: this.now(),
      });
    } catch {
      // síntese falhou — rodada permanece p/ nova tentativa
    }
  }

  private emit(event: FullBoardEvent): void {
    // B1/B2: TUDO que o conselho exibe entra na memória da reunião (anti-repetição)
    this.history.push({ agentId: event.contribution.agentId, text: event.contribution.text });
    this.semanticDedup.register(event.contribution.text);
    for (const listener of this.listeners) listener(event);
  }
}

function toCandidate(match: TriggerMatch): Candidate {
  return {
    id: randomUUID(),
    agentId: match.trigger.agentId,
    agentIds: [match.trigger.agentId],
    triggerId: match.trigger.id,
    topicKey: match.trigger.id.replace(/^[a-z]+-/, ''), // tópico sem o prefixo da persona
    type: match.trigger.typeHint,
    severity: match.trigger.severityHint,
    score: scoreMatch(match),
    segmentText: match.segmentText,
    at: match.at,
  };
}
