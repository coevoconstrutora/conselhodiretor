import type { MeetingReport, InstanceSummary } from '@conselho/telemetry';

/**
 * Relatório de telemetria da reunião (E10 — visível p/ o piloto): custo NFR7,
 * decisões do gate (calibração O2/O3), latência §11, ruído R3 e o gatilho
 * Board Ativo → Quiet Board (§13.7).
 */
export function TelemetryReport({
  report,
  summary,
}: {
  report: MeetingReport;
  summary: InstanceSummary;
}) {
  const usd = (v: number) => `US$ ${v.toFixed(4)}`;
  return (
    <section aria-label="Telemetria da reunião" className="card-premium mt-6 p-6">
      <h2 className="font-display text-base font-semibold text-ink">📊 Telemetria (piloto)</h2>

      <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div data-testid="tm-cost">
          <h3 className="text-xs font-semibold uppercase text-ink-muted">Custo (NFR7)</h3>
          <p className="font-mono-data mt-1 text-lg font-medium text-ink">{usd(report.cost.totalUsd)}</p>
          <p className="text-xs text-ink-muted">
            LLM {usd(report.cost.llmUsd)} ({report.cost.llmCalls} chamadas,{' '}
            {report.cost.llmInputTokens + report.cost.llmOutputTokens} tokens) · STT{' '}
            {usd(report.cost.sttUsd)} ({report.durationMinutes.toFixed(1)} min) · vídeo US$ 0
          </p>
        </div>

        <div data-testid="tm-gate">
          <h3 className="text-xs font-semibold uppercase text-ink-muted">Gate (calibração O2/O3)</h3>
          <p className="font-mono-data mt-1 text-xs text-ink">
            ✅ {report.gate.deliver} entregues · 🚫 {report.gate['rejected-score']} score baixo ·{' '}
            ♻️ {report.gate.duplicate} dedup · ⏸ {report.gate['held-for-pause']} pausa · 🧯{' '}
            {report.gate['rate-limited']} rate-limit
          </p>
        </div>

        <div data-testid="tm-latency">
          <h3 className="text-xs font-semibold uppercase text-ink-muted">Latência (§11)</h3>
          <p className="font-mono-data mt-1 text-xs text-ink">
            {report.latency.samples > 0
              ? `p50 ${(report.latency.p50Ms! / 1000).toFixed(1)}s · p95 ${(report.latency.p95Ms! / 1000).toFixed(1)}s (${report.latency.samples} amostras)`
              : 'sem amostras ainda'}
          </p>
        </div>

        <div data-testid="tm-autonomy">
          <h3 className="text-xs font-semibold uppercase text-ink-muted">Autonomia (anti-repetição)</h3>
          <p className="font-mono-data mt-1 text-xs text-ink">
            🤐 {report.autonomy.llmSkips} skips do LLM
            {report.autonomy.skipRate !== null
              ? ` (${(report.autonomy.skipRate * 100).toFixed(0)}%)`
              : ''}{' '}
            · ♻️ {report.autonomy.semanticDuplicates} descartes por similaridade · 🧠{' '}
            {report.autonomy.caseStateUpdates} updates do caso · 🔎 reviews:{' '}
            {report.autonomy.caseReviews.contribution} contrib. / {report.autonomy.caseReviews.skip} skip /{' '}
            {report.autonomy.caseReviews.discarded} descartados
          </p>
        </div>

        <div data-testid="tm-noise">
          <h3 className="text-xs font-semibold uppercase text-ink-muted">Ruído (R3) & aceite (§9)</h3>
          <p className="font-mono-data mt-1 text-xs text-ink">
            foco {report.ui['focus-on']}× · silenciar {report.ui.silence}× · dispensas líquidas{' '}
            {report.acceptance.dismissed} · 📌 {report.acceptance.pinned}
            {report.acceptance.rate !== null
              ? ` · aceite ${(report.acceptance.rate * 100).toFixed(0)}%`
              : ''}
          </p>
        </div>
      </div>

      <p
        data-testid="tm-quiet-board"
        className={`mt-4 rounded-[var(--radius)] px-3 py-2 text-xs ${
          summary.recommendQuietBoard
            ? 'bg-attn-bg font-semibold text-attn-critical'
            : 'bg-surface-muted text-ink-muted'
        }`}
      >
        {summary.recommendQuietBoard
          ? `⚠️ Ruído em ${((summary.noiseRate ?? 0) * 100).toFixed(0)}% das reuniãos (> 20%) — recomendar default Quiet Board (frontend-spec §13.7).`
          : `Board Ativo validado até aqui: controles anti-ruído em ${
              summary.noiseRate !== null ? `${(summary.noiseRate * 100).toFixed(0)}%` : '—'
            } das ${summary.reuniãotions} reunião(s) desta instância (gatilho Quiet Board: > 20%).`}
        {summary.avgCostUsd !== null ? ` Custo médio: ${usd(summary.avgCostUsd)}.` : ''}
      </p>
    </section>
  );
}
