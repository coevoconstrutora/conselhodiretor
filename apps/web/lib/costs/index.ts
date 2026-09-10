import 'server-only';
import type { CostRange, ProviderCostResult } from './types';
import { getAnthropicCost } from './anthropic-cost';
import { getOpenAiCost } from './openai-cost';
import { getDeepgramCost } from './deepgram-cost';
import { getRecallCost } from './recall-cost';
import { getFlyCost } from './fly-cost';

export type { CostRange, ProviderCostResult, CostKind } from './types';

/** Últimos 30 dias — cabe num único page de cost_report (máx. 31 buckets/dia). */
export function defaultCostRange(): CostRange {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Busca o custo dos 5 provedores em paralelo — uma falha isolada (chave
 * ausente, provedor fora do ar) nunca derruba o painel inteiro; cada card
 * mostra o próprio estado.
 */
export async function getAllProviderCosts(range: CostRange): Promise<ProviderCostResult[]> {
  return Promise.all([
    getAnthropicCost(range),
    getOpenAiCost(range),
    getDeepgramCost(range),
    getRecallCost(range),
    getFlyCost(range),
  ]);
}
