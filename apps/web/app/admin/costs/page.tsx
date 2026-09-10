import { redirect } from 'next/navigation';
import { requireCurrentUser } from '@/lib/auth';
import { getAllProviderCosts, defaultCostRange } from '@/lib/costs';
import { formatUsd, formatDateBR } from '@/lib/format';
import { DashboardShell } from '@/components/dashboard-shell';

const KIND_BADGE: Record<string, string> = {
  billed: '✓ faturado',
  estimated: '≈ estimado',
  unavailable: '— indisponível',
};

/** Custos de infraestrutura (Anthropic/OpenAI/Deepgram/Recall.ai/Fly.io) — só o dono da plataforma. */
export default async function CostsAdminPage() {
  const user = await requireCurrentUser();
  if (!user.isSuperAdmin) redirect('/');

  const range = defaultCostRange();
  const results = await getAllProviderCosts(range);
  const billedOrEstimated = results.filter((r) => r.amountUsd !== null);
  const total = billedOrEstimated.reduce((sum, r) => sum + (r.amountUsd ?? 0), 0);
  const hasEstimate = results.some((r) => r.kind === 'estimated');

  return (
    <DashboardShell
      pageTitle="Custos"
      subtitle={
        <>
          Gasto com infraestrutura da operação (não é custo do cliente) nos últimos 30 dias —{' '}
          {formatDateBR(range.start)} a {formatDateBR(range.end)}.
        </>
      }
    >
      <section className="card-premium mt-8 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-base font-semibold text-ink">Total do período</h2>
          <p className="font-display text-2xl font-semibold text-ink">{formatUsd(total)}</p>
        </div>
        {hasEstimate ? (
          <p className="mt-2 text-xs text-ink-muted">
            Inclui valor(es) estimado(s) — veja o detalhe em cada card. Provedores indisponíveis não entram na soma.
          </p>
        ) : null}
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r) => (
          <div key={r.providerId} className="card-premium p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-ink">{r.label}</h3>
              <span
                className={`shrink-0 rounded-[var(--radius)] px-2 py-0.5 text-[10px] font-semibold ${
                  r.kind === 'billed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : r.kind === 'estimated'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-surface-muted text-ink-muted'
                }`}
              >
                {KIND_BADGE[r.kind]}
              </span>
            </div>
            <p className="mt-3 font-display text-xl font-semibold text-ink">
              {r.amountUsd !== null ? formatUsd(r.amountUsd) : '—'}
            </p>
            {r.detail ? <p className="mt-2 text-xs leading-relaxed text-ink-muted">{r.detail}</p> : null}
          </div>
        ))}
      </section>
    </DashboardShell>
  );
}
