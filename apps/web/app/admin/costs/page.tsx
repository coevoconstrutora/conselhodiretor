import { redirect } from 'next/navigation';
import { requireCurrentUser } from '@/lib/auth';
import { getAllProviderCosts, defaultCostRange } from '@/lib/costs';
import { formatUsd, formatDateBR } from '@/lib/format';
import { DashboardShell } from '@/components/dashboard-shell';
import { CostSettingsForm } from '@/components/cost-settings-form';
import { getDb } from '@/lib/db';
import { getCostSettings } from '@/lib/system-settings';

const KIND_BADGE: Record<string, string> = {
  billed: '✓ faturado',
  estimated: '≈ estimado',
  unavailable: '— indisponível',
};

/** `2026-11-14` → `14/11` (a Costs API agrupa em dias UTC). */
function formatDayLabel(isoDay: string): string {
  return `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}`;
}

/** Lista com barra proporcional ao maior valor — sem biblioteca de gráfico. */
function BreakdownCard({
  title,
  rows,
  scrollable = false,
}: {
  title: string;
  rows: readonly { label: string; usd: number }[];
  scrollable?: boolean;
}) {
  const max = Math.max(0, ...rows.map((r) => r.usd));
  return (
    <div className="card-premium p-5">
      <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
      <ul className={`mt-3 space-y-2 ${scrollable ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
        {rows.map((row) => (
          <li key={row.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 break-words text-ink">{row.label}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">{formatUsd(row.usd)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
              <div
                className="h-1.5 rounded-full bg-emerald-500"
                style={{ width: `${max > 0 ? Math.max(row.usd > 0 ? 2 : 0, (row.usd / max) * 100) : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Custos de infraestrutura (Anthropic/OpenAI/Deepgram/Recall.ai/Fly.io) — só o dono da plataforma. */
export default async function CostsAdminPage() {
  const user = await requireCurrentUser();
  if (!user.isSuperAdmin) redirect('/');

  const range = defaultCostRange();
  const results = await getAllProviderCosts(range);
  const billedOrEstimated = results.filter((r) => r.amountUsd !== null);
  const total = billedOrEstimated.reduce((sum, r) => sum + (r.amountUsd ?? 0), 0);
  const hasEstimate = results.some((r) => r.kind === 'estimated');
  const costSettings = await getCostSettings(await getDb());

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

      <CostSettingsForm
        limitUsd={costSettings.meetingCostLimitUsd}
        limitSource={costSettings.limitSource}
        pricesJson={JSON.stringify(costSettings.modelPrices, null, 2)}
        pricesSource={costSettings.pricesSource}
      />

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

      {results.map((r) =>
        r.breakdown && (r.breakdown.byItem.length > 0 || r.breakdown.byDay.length > 0) ? (
          <section key={`${r.providerId}-detail`} className="mt-6">
            <h2 className="font-display text-base font-semibold text-ink">{r.label} — detalhamento</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <BreakdownCard title="Por modelo e tipo de token" rows={r.breakdown.byItem.slice(0, 12)} />
              <BreakdownCard
                title="Por dia (UTC)"
                rows={r.breakdown.byDay.map((d) => ({ label: formatDayLabel(d.label), usd: d.usd }))}
                scrollable
              />
            </div>
          </section>
        ) : null,
      )}
    </DashboardShell>
  );
}
