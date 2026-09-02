import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getExperiment, listExperimentMeetingResults } from '@conselho/meeting-report';
import { getAgentProfiles } from '@conselho/kb';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { DashboardShell } from '@/components/dashboard-shell';
import { ExperimentActions } from '@/components/experiment-detail';

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCurrentUser();
  if (!canWrite(user)) notFound();
  const { id } = await params;

  const db = await getDb();
  const experiment = await getExperiment(db, user.companyId, id);
  if (!experiment) notFound();

  await loadAndApplyProfileOverrides(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);
  const targetLabel =
    experiment.targetType === 'president_synthesis'
      ? 'Síntese do Presidente'
      : (profiles[experiment.targetAgentId ?? '']?.displayName ?? experiment.targetAgentId ?? '—');

  const results = await listExperimentMeetingResults(db, id, getEncryptionKey());
  const eligibleResults = results.filter((r) => r.eligible);
  const avgBaseline = average(eligibleResults.flatMap((r) => (r.baselineScore !== null ? [r.baselineScore] : [])));
  const avgCandidate = average(eligibleResults.flatMap((r) => (r.candidateScore !== null ? [r.candidateScore] : [])));
  const totalCost = eligibleResults.reduce((sum, r) => sum + (r.candidateCostUsd ?? 0), 0);
  const avgLatency = average(eligibleResults.flatMap((r) => (r.candidateLatencyMs !== null ? [r.candidateLatencyMs] : [])));

  return (
    <DashboardShell pageTitle={experiment.name}>
      <div className="mt-6 flex items-center gap-2">
        <Link href="/improvements" className="text-xs text-ink-muted hover:text-ink hover:underline">
          ← Aprendizado do Conselho
        </Link>
      </div>

      <section className="card-premium mt-4 p-6">
        <p className="text-xs text-ink-muted">{experiment.objective}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--radius)] border border-ink/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Configuração atual</p>
            <p className="mt-1 text-sm text-ink">{targetLabel}</p>
            <p className="text-sm text-ink-muted">
              {experiment.baselineModel} / {experiment.baselineReasoningEffort}
            </p>
          </div>
          <div className="rounded-[var(--radius)] border border-brand/30 bg-brand/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">Configuração candidata</p>
            <p className="mt-1 text-sm text-ink">{targetLabel}</p>
            <p className="text-sm text-ink-muted">
              {experiment.candidateModel} / {experiment.candidateReasoningEffort}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-[var(--radius)] border border-ink/10 p-3 text-center">
            <p className="text-[11px] text-ink-muted">Qualidade (baseline)</p>
            <p className="text-xl font-semibold text-ink">{avgBaseline !== null ? avgBaseline.toFixed(1) : '—'}</p>
          </div>
          <div className="rounded-[var(--radius)] border border-ink/10 p-3 text-center">
            <p className="text-[11px] text-ink-muted">Qualidade (candidata)</p>
            <p className="text-xl font-semibold text-ink">{avgCandidate !== null ? avgCandidate.toFixed(1) : '—'}</p>
          </div>
          <div className="rounded-[var(--radius)] border border-ink/10 p-3 text-center">
            <p className="text-[11px] text-ink-muted">Custo (candidata)</p>
            <p className="text-xl font-semibold text-ink">US$ {totalCost.toFixed(2)}</p>
          </div>
          <div className="rounded-[var(--radius)] border border-ink/10 p-3 text-center">
            <p className="text-[11px] text-ink-muted">Latência média</p>
            <p className="text-xl font-semibold text-ink">{avgLatency !== null ? `${Math.round(avgLatency)}ms` : '—'}</p>
          </div>
        </div>

        <div className="mt-4">
          <ExperimentActions experimentId={id} status={experiment.status} result={experiment.result} />
        </div>
      </section>

      <section aria-label="Comparação por reunião" className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">Comparação por reunião</h2>
        {results.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Experimento ainda não rodou.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Reunião</th>
                  <th className="px-3 py-2">Baseline</th>
                  <th className="px-3 py-2">Candidata</th>
                  <th className="px-3 py-2">Custo</th>
                  <th className="px-3 py-2">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {results.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium text-ink">{r.meetingTitle}</td>
                    {r.eligible ? (
                      <>
                        <td className="px-3 py-2 text-ink-muted">{r.baselineScore ?? '—'}</td>
                        <td className="px-3 py-2 text-ink-muted">{r.candidateScore ?? '—'}</td>
                        <td className="px-3 py-2 text-ink-muted">
                          {r.candidateCostUsd !== null ? `US$ ${r.candidateCostUsd.toFixed(3)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{r.note ?? '—'}</td>
                      </>
                    ) : (
                      <td className="px-3 py-2 text-ink-muted" colSpan={4}>
                        Não elegível — {r.ineligibleReason ?? 'motivo desconhecido'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
