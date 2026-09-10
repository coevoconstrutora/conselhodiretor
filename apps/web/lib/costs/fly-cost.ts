import 'server-only';
import type { CostRange, ProviderCostResult } from './types';
import { estimateFlyMonthlyCostUsd, scaleMonthlyToRangeUsd, type FlyMachine } from './calc';

/**
 * Fly.io NÃO publica nenhuma API de billing/fatura (confirmado em
 * fly.io/docs/about/billing — só "baixe sua fatura pelo dashboard"). Este
 * módulo estima o custo a partir do que está REALMENTE rodando agora
 * (Fly Machines API, essa sim documentada e pública) × tarifa pública
 * aproximada — nunca é o valor exato da fatura (não inclui banda, volumes,
 * IPs dedicados, certificados, nem o multiplicador de preço por região, que
 * a Fly não expõe publicamente como tabela).
 *
 * FLY_API_TOKEN: `fly tokens create readonly -a <app>` (ou `flyctl auth token`).
 * FLY_APP_NAME: em produção a própria Fly injeta essa env var no processo;
 * em dev, cai no nome do fly.toml.
 */
const MACHINES_API_BASE = 'https://api.machines.dev/v1';
const DEFAULT_APP_NAME = 'conselho-diretor';

export async function getFlyCost(range: CostRange): Promise<ProviderCostResult> {
  const apiToken = process.env.FLY_API_TOKEN;
  if (!apiToken) {
    return {
      providerId: 'fly',
      label: 'Fly.io',
      amountUsd: null,
      kind: 'unavailable',
      detail: 'FLY_API_TOKEN não configurado (a Fly não tem API de billing — isto só estima pelas máquinas ativas).',
    };
  }
  const appName = process.env.FLY_APP_NAME || DEFAULT_APP_NAME;
  try {
    const res = await fetch(`${MACHINES_API_BASE}/apps/${appName}/machines`, {
      headers: { authorization: `Bearer ${apiToken}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const machines = (await res.json()) as FlyMachine[];
    const { monthlyUsd, runningCount, uncoveredCount } = estimateFlyMonthlyCostUsd(machines);
    const amountUsd = scaleMonthlyToRangeUsd(monthlyUsd, range.start, range.end);
    const uncoveredNote = uncoveredCount > 0 ? ` (${uncoveredCount} máquina(s) com CPU dedicada não estimada(s))` : '';
    return {
      providerId: 'fly',
      label: 'Fly.io',
      amountUsd,
      kind: 'estimated',
      detail: `Estimado: ${runningCount} máquina(s) ativa(s) × tarifa pública, sem banda/volumes/região.${uncoveredNote} Confira o valor real na fatura do dashboard Fly.`,
    };
  } catch (err) {
    return {
      providerId: 'fly',
      label: 'Fly.io',
      amountUsd: null,
      kind: 'unavailable',
      detail: err instanceof Error ? err.message : 'Falha ao consultar a Machines API da Fly.',
    };
  }
}
