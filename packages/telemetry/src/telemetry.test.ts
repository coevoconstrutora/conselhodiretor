import { describe, it, expect } from 'vitest';
import { TelemetryRegistry, PRICING } from './telemetry';

describe('TelemetryRegistry (E10)', () => {
  it('AC1/NFR7 — custo por consulta: LLM por tokens + STT por minuto + vídeo zero', () => {
    const t = new TelemetryRegistry();
    t.sessionStarted('c1', 0);
    t.llmUsage('c1', 2_000_000, 100_000); // 2M in, 0.1M out
    t.llmUsage('c1', 1_000_000, 100_000);
    t.sessionEnded('c1', 10 * 60_000); // 10 min

    const report = t.report('c1');
    expect(report.cost.llmCalls).toBe(2);
    expect(report.cost.llmUsd).toBeCloseTo(3 * PRICING.llmInputPerMTok * 1 + 0.2 * PRICING.llmOutputPerMTok, 5);
    expect(report.cost.sttUsd).toBeCloseTo(10 * PRICING.sttPerMinute, 5);
    expect(report.cost.videoUsd).toBe(0); // ADR-007
    expect(report.cost.totalUsd).toBeCloseTo(report.cost.llmUsd + report.cost.sttUsd, 5);
    expect(report.durationMinutes).toBeCloseTo(10, 3);
  });

  it('AC6/O2-O3 — decisões do gate são contadas por tipo (calibração)', () => {
    const t = new TelemetryRegistry();
    t.gateDecision('c1', 'deliver');
    t.gateDecision('c1', 'deliver');
    t.gateDecision('c1', 'rejected-score');
    t.gateDecision('c1', 'held-for-pause');
    t.gateDecision('c1', 'rate-limited');
    t.gateDecision('c1', 'duplicate');
    t.gateDecision('c1', 'llm-skip');
    t.gateDecision('c1', 'semantic-duplicate');

    const report = t.report('c1');
    expect(report.gate).toEqual({
      deliver: 2,
      'rejected-score': 1,
      duplicate: 1,
      'held-for-pause': 1,
      'rate-limited': 1,
      'llm-skip': 1,
      'semantic-duplicate': 1,
    });
  });

  it('B5 — autonomia: skips, dedup semântico, updates do caso e reviews no report', () => {
    const t = new TelemetryRegistry();
    t.gateDecision('c1', 'deliver');
    t.gateDecision('c1', 'llm-skip');
    t.gateDecision('c1', 'llm-skip');
    t.gateDecision('c1', 'semantic-duplicate');
    t.caseStateUpdate('c1');
    t.caseStateUpdate('c1');
    t.caseReview('c1', 'skip');
    t.caseReview('c1', 'contribution');
    t.caseReview('c1', 'discarded');
    t.caseReview('c1', 'skip');

    const { autonomy } = t.report('c1');
    expect(autonomy).toEqual({
      llmSkips: 2,
      semanticDuplicates: 1,
      caseStateUpdates: 2,
      caseReviews: { skip: 2, contribution: 1, discarded: 1 },
      skipRate: 2 / 3, // 2 skips / (2 skips + 1 entregue)
    });
  });

  it('B5 — consulta sem atividade: autonomia zerada com skipRate null', () => {
    const t = new TelemetryRegistry();
    const { autonomy } = t.report('c-vazia');
    expect(autonomy.skipRate).toBeNull();
    expect(autonomy.llmSkips).toBe(0);
    expect(autonomy.caseReviews).toEqual({ skip: 0, contribution: 0, discarded: 0 });
  });

  it('AC4/§11 — latência fim-a-fim com p50/p95', () => {
    const t = new TelemetryRegistry();
    for (const ms of [1000, 2000, 3000, 4000, 10_000]) t.contributionLatency('c1', ms);
    t.contributionLatency('c1', -5); // inválida é descartada
    const { latency } = t.report('c1');
    expect(latency.samples).toBe(5);
    expect(latency.p50Ms).toBe(3000);
    expect(latency.p95Ms).toBe(10_000);
  });

  it('AC2/AC3 — eventos de UI, controles de ruído e taxa de aceite', () => {
    const t = new TelemetryRegistry();
    t.gateDecision('c1', 'deliver');
    t.gateDecision('c1', 'deliver');
    t.gateDecision('c1', 'deliver');
    t.uiEvent('c1', 'dismiss');
    t.uiEvent('c1', 'dismiss');
    t.uiEvent('c1', 'undo-dismiss'); // 1 dispensa líquida
    t.uiEvent('c1', 'pin');
    t.uiEvent('c1', 'focus-on');

    const report = t.report('c1');
    expect(report.noiseControlsUsed).toBe(true); // usou Modo Foco (R3)
    expect(report.acceptance).toMatchObject({ delivered: 3, dismissed: 1, pinned: 1 });
    expect(report.acceptance.rate).toBeCloseTo(2 / 3, 5);
  });

  it('AC5/§13.7 — gatilho Quiet Board quando ruído > 20%', () => {
    const t = new TelemetryRegistry();
    // 5 consultas, 1 com controles de ruído = 20% (não dispara)
    for (let i = 1; i <= 5; i++) t.sessionStarted(`c${i}`, 0);
    t.uiEvent('c1', 'silence');
    expect(t.summary().recommendQuietBoard).toBe(false);
    expect(t.summary().noiseRate).toBeCloseTo(0.2, 5);

    // 2 de 5 = 40% → dispara recomendação
    t.uiEvent('c2', 'focus-on');
    const summary = t.summary();
    expect(summary.noiseRate).toBeCloseTo(0.4, 5);
    expect(summary.recommendQuietBoard).toBe(true);
  });

  it('consulta sem dados gera relatório zerado sem explodir', () => {
    const t = new TelemetryRegistry();
    const report = t.report('vazia');
    expect(report.cost.totalUsd).toBe(0);
    expect(report.latency.p50Ms).toBeNull();
    expect(report.acceptance.rate).toBeNull();
  });
});
