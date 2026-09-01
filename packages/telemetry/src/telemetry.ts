/**
 * Telemetria do board (E10 — NFR7/NFR12, R3, O2/O3).
 *
 * Registro EM MEMÓRIA por reunião (runtime stateful — ADR-005): custo
 * (LLM/STT), decisões do gate (calibração de limiar/rate/pausa), latência
 * fim-a-fim e eventos de UI (silenciar/Modo Foco/dispensar/fixar).
 * Persistência/agregação histórica entra com o runtime de produção; o piloto
 * opera com o relatório por reunião + sumário da instância.
 *
 * Conteúdo clínico NUNCA entra aqui — só contadores e durações (NFR9).
 */

export type GateDecisionKind =
  | 'deliver'
  | 'rejected-score'
  | 'duplicate'
  | 'held-for-pause'
  | 'rate-limited'
  /** B1: o LLM declarou não ter nada novo — descartado sem exibir (anti-repetição). */
  | 'llm-skip'
  /** B2: similar demais a algo já exibido na reunião (keywords/Jaccard) — descartado. */
  | 'semantic-duplicate';

export type UiEventKind = 'focus-on' | 'focus-off' | 'silence' | 'unsilence' | 'dismiss' | 'pin' | 'undo-dismiss';

/** Preços de referência (USD) — atualizar junto com a POC 3.4/2.5. */
export const PRICING = {
  llmInputPerMTok: 3.0, // claude-sonnet-5 (piso 5.x do produto — NUNCA modelo abaixo disso)
  llmOutputPerMTok: 15.0,
  sttPerMinute: 0.0059, // deepgram nova-2 streaming
  videoPerConsultation: 0, // catálogo pré-renderizado (ADR-007)
} as const;

/** B4/B5: desfecho de um case review periódico. */
export type CaseReviewOutcome = 'skip' | 'contribution' | 'discarded';

interface MeetingRecord {
  startedAt: number | null;
  endedAt: number | null;
  llmCalls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  sttSegments: number;
  decisions: Map<GateDecisionKind, number>;
  latenciesMs: number[];
  uiEvents: Map<UiEventKind, number>;
  contributionsDelivered: number;
  /** B3/B5: updates do CaseState concluídos. */
  caseStateUpdates: number;
  /** B4/B5: reviews periódicos por desfecho. */
  caseReviews: Map<CaseReviewOutcome, number>;
}

export interface MeetingReport {
  readonly meetingId: string;
  readonly durationMinutes: number;
  readonly cost: {
    readonly llmUsd: number;
    readonly sttUsd: number;
    readonly videoUsd: number;
    readonly totalUsd: number;
    readonly llmCalls: number;
    readonly llmInputTokens: number;
    readonly llmOutputTokens: number;
  };
  /** Decisões do gate — base de calibração (O2/O3). */
  readonly gate: Readonly<Record<GateDecisionKind, number>>;
  readonly latency: { readonly samples: number; readonly p50Ms: number | null; readonly p95Ms: number | null };
  readonly ui: Readonly<Record<UiEventKind, number>>;
  /** R3: a reunião usou controles anti-ruído? */
  readonly noiseControlsUsed: boolean;
  readonly acceptance: { readonly delivered: number; readonly dismissed: number; readonly pinned: number; readonly rate: number | null };
  /** B5 — medidores da autonomia anti-repetição (B1–B4). */
  readonly autonomy: {
    readonly llmSkips: number;
    readonly semanticDuplicates: number;
    readonly caseStateUpdates: number;
    readonly caseReviews: Readonly<Record<CaseReviewOutcome, number>>;
    /** llm-skip / (llm-skip + entregues) — proporção de chamadas em que o modelo se calou. */
    readonly skipRate: number | null;
  };
}

export interface InstanceSummary {
  readonly reuniãotions: number;
  readonly reuniãotionsWithNoiseControls: number;
  readonly noiseRate: number | null;
  /** frontend-spec §13.7: ruído > 20% ⇒ recomendar default Quiet Board. */
  readonly recommendQuietBoard: boolean;
  readonly avgCostUsd: number | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export class TelemetryRegistry {
  private readonly records = new Map<string, MeetingRecord>();
  /** TTL de retenção pós-encerramento (default 24h) — evita RSS crescer sem bound. */
  private readonly retentionMs: number;

  constructor(opts: { retentionMs?: number } = {}) {
    this.retentionMs = opts.retentionMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Purga registros de reuniões ENCERRADAS há mais que o TTL. Chamar
   * periodicamente (ex.: no tick do runtime) — reuniões ativas nunca são
   * removidas. Correção do vazamento de memória herdado do NutriMed.
   */
  purgeExpired(now = Date.now()): number {
    let purged = 0;
    for (const [id, rec] of this.records) {
      if (rec.endedAt !== null && now - rec.endedAt > this.retentionMs) {
        this.records.delete(id);
        purged += 1;
      }
    }
    return purged;
  }

  private record(meetingId: string): MeetingRecord {
    let rec = this.records.get(meetingId);
    if (!rec) {
      rec = {
        startedAt: null,
        endedAt: null,
        llmCalls: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        sttSegments: 0,
        decisions: new Map(),
        latenciesMs: [],
        uiEvents: new Map(),
        contributionsDelivered: 0,
        caseStateUpdates: 0,
        caseReviews: new Map(),
      };
      this.records.set(meetingId, rec);
    }
    return rec;
  }

  sessionStarted(meetingId: string, at = Date.now()): void {
    const rec = this.record(meetingId);
    rec.startedAt = rec.startedAt ?? at;
    rec.endedAt = null;
  }

  sessionEnded(meetingId: string, at = Date.now()): void {
    this.record(meetingId).endedAt = at;
  }

  llmUsage(meetingId: string, inputTokens: number, outputTokens: number): void {
    const rec = this.record(meetingId);
    rec.llmCalls += 1;
    rec.llmInputTokens += inputTokens;
    rec.llmOutputTokens += outputTokens;
  }

  sttSegment(meetingId: string): void {
    this.record(meetingId).sttSegments += 1;
  }

  gateDecision(meetingId: string, kind: GateDecisionKind): void {
    const rec = this.record(meetingId);
    rec.decisions.set(kind, (rec.decisions.get(kind) ?? 0) + 1);
    if (kind === 'deliver') rec.contributionsDelivered += 1;
  }

  /** Latência fala(final do gatilho)→publicação (§11). */
  contributionLatency(meetingId: string, latencyMs: number): void {
    if (latencyMs >= 0) this.record(meetingId).latenciesMs.push(latencyMs);
  }

  uiEvent(meetingId: string, kind: UiEventKind): void {
    const rec = this.record(meetingId);
    rec.uiEvents.set(kind, (rec.uiEvents.get(kind) ?? 0) + 1);
  }

  /** B3/B5: update do CaseState concluído. */
  caseStateUpdate(meetingId: string): void {
    this.record(meetingId).caseStateUpdates += 1;
  }

  /** B4/B5: desfecho de um case review periódico. */
  caseReview(meetingId: string, outcome: CaseReviewOutcome): void {
    const rec = this.record(meetingId);
    rec.caseReviews.set(outcome, (rec.caseReviews.get(outcome) ?? 0) + 1);
  }

  report(meetingId: string, now = Date.now()): MeetingReport {
    const rec = this.record(meetingId);
    const durationMs = rec.startedAt !== null ? (rec.endedAt ?? now) - rec.startedAt : 0;
    const durationMinutes = durationMs / 60_000;
    const llmUsd =
      (rec.llmInputTokens / 1_000_000) * PRICING.llmInputPerMTok +
      (rec.llmOutputTokens / 1_000_000) * PRICING.llmOutputPerMTok;
    const sttUsd = durationMinutes * PRICING.sttPerMinute;
    const sorted = [...rec.latenciesMs].sort((a, b) => a - b);
    const decisions = Object.fromEntries(
      ([
        'deliver',
        'rejected-score',
        'duplicate',
        'held-for-pause',
        'rate-limited',
        'llm-skip',
        'semantic-duplicate',
      ] as const).map(
        (k) => [k, rec.decisions.get(k) ?? 0],
      ),
    ) as Record<GateDecisionKind, number>;
    const ui = Object.fromEntries(
      (['focus-on', 'focus-off', 'silence', 'unsilence', 'dismiss', 'pin', 'undo-dismiss'] as const).map(
        (k) => [k, rec.uiEvents.get(k) ?? 0],
      ),
    ) as Record<UiEventKind, number>;
    const dismissed = ui.dismiss - ui['undo-dismiss'];
    return {
      meetingId,
      durationMinutes,
      cost: {
        llmUsd,
        sttUsd,
        videoUsd: PRICING.videoPerConsultation,
        totalUsd: llmUsd + sttUsd + PRICING.videoPerConsultation,
        llmCalls: rec.llmCalls,
        llmInputTokens: rec.llmInputTokens,
        llmOutputTokens: rec.llmOutputTokens,
      },
      gate: decisions,
      latency: { samples: sorted.length, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95) },
      ui,
      noiseControlsUsed: ui['focus-on'] > 0 || ui.silence > 0,
      acceptance: {
        delivered: rec.contributionsDelivered,
        dismissed: Math.max(0, dismissed),
        pinned: ui.pin,
        rate:
          rec.contributionsDelivered > 0
            ? Math.max(0, rec.contributionsDelivered - Math.max(0, dismissed)) / rec.contributionsDelivered
            : null,
      },
      autonomy: {
        llmSkips: decisions['llm-skip'],
        semanticDuplicates: decisions['semantic-duplicate'],
        caseStateUpdates: rec.caseStateUpdates,
        caseReviews: {
          skip: rec.caseReviews.get('skip') ?? 0,
          contribution: rec.caseReviews.get('contribution') ?? 0,
          discarded: rec.caseReviews.get('discarded') ?? 0,
        },
        skipRate:
          decisions['llm-skip'] + rec.contributionsDelivered > 0
            ? decisions['llm-skip'] / (decisions['llm-skip'] + rec.contributionsDelivered)
            : null,
      },
    };
  }

  /** Sumário da instância + gatilho Board Ativo → Quiet Board (§13.7). */
  summary(now = Date.now()): InstanceSummary {
    const ids = [...this.records.keys()];
    const reports = ids.map((id) => this.report(id, now));
    const withControls = reports.filter((r) => r.noiseControlsUsed).length;
    const noiseRate = reports.length > 0 ? withControls / reports.length : null;
    const costs = reports.map((r) => r.cost.totalUsd);
    return {
      reuniãotions: reports.length,
      reuniãotionsWithNoiseControls: withControls,
      noiseRate,
      recommendQuietBoard: noiseRate !== null && noiseRate > 0.2,
      avgCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    };
  }
}
