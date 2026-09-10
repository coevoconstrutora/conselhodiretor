import 'server-only';
import type { CostRange, ProviderCostResult } from './types';
import { estimateRecallCostUsd } from './calc';

/**
 * Recall.ai só expõe MINUTOS de bot usados (/api/v1/billing/usage/), nunca um
 * valor em dólar — por isso o custo aqui é sempre ESTIMADO (uso × tarifa
 * pública), nunca 'billed'. RECALL_HOURLY_RATE_USD permite corrigir a tarifa
 * se o plano contratado divergir do preço de tabela (docs.recall.ai/docs/
 * calculating-usage — US$ 0,50/hora de bot ativo em 2026).
 * Reusa RECALL_API_KEY/RECALL_API_BASE_URL já configuradas para o bot de
 * visualização de reunião (mesmo formato de header usado em recall-actions.ts).
 */
const DEFAULT_BASE = 'https://us-west-2.recall.ai';
const DEFAULT_HOURLY_RATE_USD = 0.5;

interface BillingUsageResponse {
  readonly bot_total: number; // segundos
}

export async function getRecallCost(range: CostRange): Promise<ProviderCostResult> {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) {
    return {
      providerId: 'recall',
      label: 'Recall.ai',
      amountUsd: null,
      kind: 'unavailable',
      detail: 'RECALL_API_KEY não configurada.',
    };
  }
  const base = (process.env.RECALL_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const hourlyRate = Number(process.env.RECALL_HOURLY_RATE_USD) || DEFAULT_HOURLY_RATE_USD;
  try {
    const params = new URLSearchParams({
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    });
    const res = await fetch(`${base}/api/v1/billing/usage/?${params.toString()}`, {
      headers: { authorization: apiKey, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as BillingUsageResponse;
    const amountUsd = estimateRecallCostUsd(json.bot_total, hourlyRate);
    const hours = json.bot_total / 3600;
    return {
      providerId: 'recall',
      label: 'Recall.ai',
      amountUsd,
      kind: 'estimated',
      detail: `Estimado: ${hours.toFixed(1)}h de bot × US$ ${hourlyRate.toFixed(2)}/h — confira o valor real na fatura do Recall.ai.`,
    };
  } catch (err) {
    return {
      providerId: 'recall',
      label: 'Recall.ai',
      amountUsd: null,
      kind: 'unavailable',
      detail: err instanceof Error ? err.message : 'Falha ao consultar o uso de bot do Recall.ai.',
    };
  }
}
