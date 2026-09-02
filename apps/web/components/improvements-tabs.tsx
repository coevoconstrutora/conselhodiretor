'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { MeetingImprovement } from '@conselho/meeting-report';
import type { AgentProfile } from '@conselho/kb';
import type { AgentId } from '@conselho/providers';
import { formatDateTimeBR } from '@/lib/format';

const TABS = [
  { key: 'geral', label: 'Visão Geral' },
  { key: 'conselheiros', label: 'Conselheiros' },
  { key: 'reunioes', label: 'Reuniões' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const SCORE_DIMENSION_LABEL: Record<string, string> = {
  counselorRelevance: 'Relevância dos conselheiros',
  routingQuality: 'Qualidade do roteamento',
  suggestionQuality: 'Qualidade das sugestões',
  redundancyControl: 'Controle de redundância',
  presidentQuality: 'Qualidade da síntese do Presidente',
  decisionClarity: 'Clareza das decisões',
  actionItemQuality: 'Qualidade das ações',
  knowledgeGrounding: 'Uso da base de conhecimento',
  meetingContinuity: 'Continuidade com a reunião anterior',
};

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function scoreBadgeClass(score: number | null): string {
  if (score === null) return 'bg-ink/10 text-ink-muted';
  if (score >= 90) return 'bg-success/10 text-success';
  if (score >= 75) return 'bg-brand/10 text-brand';
  if (score >= 60) return 'bg-attn-bg text-attn-critical';
  return 'bg-attn-critical/10 text-attn-critical';
}

export function ImprovementsTabs({
  improvements,
  profiles,
}: {
  improvements: readonly MeetingImprovement[];
  profiles: Record<AgentId, AgentProfile>;
}) {
  const [active, setActive] = useState<TabKey>('geral');

  // mais antiga → mais recente (a lista chega ordenada DESC por created_at)
  const chronological = useMemo(() => [...improvements].reverse(), [improvements]);

  const overview = useMemo(() => {
    const scores = chronological.flatMap((i) => (i.analysis?.overallScore !== null && i.analysis?.overallScore !== undefined ? [i.analysis.overallScore] : []));
    const costs = chronological.flatMap((i) =>
      i.analysis?.costAnalysis.estimatedCostUsd !== null && i.analysis?.costAnalysis.estimatedCostUsd !== undefined
        ? [i.analysis.costAnalysis.estimatedCostUsd]
        : [],
    );
    const latencies = chronological.flatMap((i) =>
      i.analysis?.costAnalysis.latencyP50Ms !== null && i.analysis?.costAnalysis.latencyP50Ms !== undefined
        ? [i.analysis.costAnalysis.latencyP50Ms]
        : [],
    );
    const half = Math.floor(scores.length / 2);
    const olderAvg = half > 0 ? average(scores.slice(0, half)) : null;
    const recentAvg = half > 0 ? average(scores.slice(half)) : null;
    return {
      avgScore: average(scores),
      meetingsAnalyzed: chronological.length,
      avgCost: average(costs),
      avgLatencyMs: average(latencies),
      trend: olderAvg !== null && recentAvg !== null ? recentAvg - olderAvg : null,
      sufficientData: scores.length >= 3,
    };
  }, [chronological]);

  const counselorRollup = useMemo(() => {
    const byAgent = new Map<AgentId, { timesInvoked: number; notes: string[] }>();
    for (const item of chronological) {
      for (const c of item.analysis?.counselorAnalysis ?? []) {
        const entry = byAgent.get(c.agentId) ?? { timesInvoked: 0, notes: [] };
        entry.timesInvoked += c.timesInvoked;
        if (c.note) entry.notes.push(c.note);
        byAgent.set(c.agentId, entry);
      }
    }
    return [...byAgent.entries()]
      .map(([agentId, v]) => ({ agentId, timesInvoked: v.timesInvoked, recentNote: v.notes.at(-1) ?? null }))
      .sort((a, b) => b.timesInvoked - a.timesInvoked);
  }, [chronological]);

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Aprendizado do Conselho" className="flex flex-wrap gap-1 border-b border-ink/10 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`rounded-[var(--radius)] px-3 py-1.5 text-sm font-semibold transition-colors ${
              active === tab.key ? 'bg-brand text-white' : 'text-ink-muted hover:bg-surface-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {active === 'geral' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card-premium p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Board Quality Score</p>
              <p className="mt-1 text-3xl font-semibold text-ink">
                {overview.avgScore !== null ? Math.round(overview.avgScore) : '—'}
              </p>
              {overview.trend !== null ? (
                <p className={`mt-1 text-xs font-medium ${overview.trend >= 0 ? 'text-success' : 'text-attn-critical'}`}>
                  {overview.trend >= 0 ? '▲' : '▼'} {Math.abs(Math.round(overview.trend))} vs. início do período
                </p>
              ) : null}
              {!overview.sufficientData ? (
                <p className="mt-1 text-[11px] text-ink-muted">Dados insuficientes para comparação histórica (mín. 3 reuniões).</p>
              ) : null}
            </div>
            <div className="card-premium p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Reuniões analisadas</p>
              <p className="mt-1 text-3xl font-semibold text-ink">{overview.meetingsAnalyzed}</p>
            </div>
            <div className="card-premium p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Custo médio de IA</p>
              <p className="mt-1 text-3xl font-semibold text-ink">
                {overview.avgCost !== null ? `US$ ${overview.avgCost.toFixed(2)}` : '—'}
              </p>
            </div>
            <div className="card-premium p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Latência mediana</p>
              <p className="mt-1 text-3xl font-semibold text-ink">
                {overview.avgLatencyMs !== null ? `${Math.round(overview.avgLatencyMs)}ms` : '—'}
              </p>
            </div>
          </div>
        ) : null}

        {active === 'conselheiros' ? (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-ink/10">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-surface-muted/60 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Conselheiro</th>
                  <th className="px-3 py-2">Invocações (histórico)</th>
                  <th className="px-3 py-2">Nota mais recente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {counselorRollup.map((c) => (
                  <tr key={c.agentId}>
                    <td className="px-3 py-2 font-medium text-ink">{profiles[c.agentId]?.displayName ?? c.agentId}</td>
                    <td className="px-3 py-2 text-ink-muted">{c.timesInvoked}</td>
                    <td className="px-3 py-2 text-ink-muted">{c.recentNote ?? '—'}</td>
                  </tr>
                ))}
                {counselorRollup.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-sm text-ink-muted">
                      Sem dados de conselheiros ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {active === 'reunioes' ? (
          <ul className="space-y-4">
            {improvements.map((item) => (
              <li key={item.id} className="card-premium p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/meetings/${item.meetingId}`} className="text-sm font-semibold text-ink hover:underline">
                    {item.meetingTitle}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreBadgeClass(item.analysis?.overallScore ?? null)}`}>
                      {item.analysis?.overallScore !== null && item.analysis?.overallScore !== undefined ? `${item.analysis.overallScore}/100` : 'sem score'}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {formatDateTimeBR(item.createdAt)}
                      {item.modelVersion ? ` · ${item.modelVersion}` : ''}
                    </span>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{item.narrative}</p>
                {item.analysis ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-ink-muted">Ver análise completa</summary>
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {(Object.entries(item.analysis.scores) as Array<[string, number | null]>)
                          .filter(([, v]) => v !== null)
                          .map(([dim, v]) => (
                            <div key={dim} className="flex items-center justify-between rounded-[var(--radius)] border border-ink/10 px-2.5 py-1.5 text-xs">
                              <span className="text-ink-muted">{SCORE_DIMENSION_LABEL[dim] ?? dim}</span>
                              <span className="font-semibold text-ink">{v}</span>
                            </div>
                          ))}
                      </div>
                      {item.analysis.strengths.length > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-ink">Pontos fortes</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                            {item.analysis.strengths.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {item.analysis.problems.length > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-ink">Problemas identificados</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                            {item.analysis.problems.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {item.analysis.recommendations.length > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-ink">Recomendações</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                            {item.analysis.recommendations.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
