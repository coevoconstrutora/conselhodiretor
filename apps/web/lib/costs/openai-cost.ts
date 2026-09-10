import 'server-only';
import type { CostRange, ProviderCostResult } from './types';
import { sumOpenAiCostUsd, type OpenAiCostBucket } from './calc';

/**
 * OpenAI Costs API (/v1/organization/costs) — exige uma Admin API key
 * (platform.openai.com/settings/organization/admin-keys), diferente da
 * OPENAI_API_KEY normal. Só relevante se a empresa usa OpenAI como
 * LLM_PROVIDER — sem a chave admin, o card aparece como indisponível, sem
 * quebrar o resto do painel.
 */
const COSTS_URL = 'https://api.openai.com/v1/organization/costs';

interface CostsResponse {
  readonly data: readonly OpenAiCostBucket[];
  readonly has_more: boolean;
  readonly next_page: string | null;
}

export async function getOpenAiCost(range: CostRange): Promise<ProviderCostResult> {
  const apiKey = process.env.OPENAI_ADMIN_API_KEY;
  if (!apiKey) {
    return {
      providerId: 'openai',
      label: 'OpenAI',
      amountUsd: null,
      kind: 'unavailable',
      detail: 'OPENAI_ADMIN_API_KEY não configurada (Admin API key, diferente da chave normal do board).',
    };
  }
  try {
    let totalUsd = 0;
    let page: string | null = null;
    do {
      const params = new URLSearchParams({
        start_time: String(Math.floor(range.start.getTime() / 1000)),
        end_time: String(Math.floor(range.end.getTime() / 1000)),
        bucket_width: '1d',
        limit: '180',
      });
      if (page) params.set('page', page);
      const res = await fetch(`${COSTS_URL}?${params.toString()}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as CostsResponse;
      totalUsd += sumOpenAiCostUsd(json.data);
      page = json.has_more ? json.next_page : null;
    } while (page);
    return { providerId: 'openai', label: 'OpenAI', amountUsd: totalUsd, kind: 'billed' };
  } catch (err) {
    return {
      providerId: 'openai',
      label: 'OpenAI',
      amountUsd: null,
      kind: 'unavailable',
      detail: err instanceof Error ? err.message : 'Falha ao consultar a Costs API da OpenAI.',
    };
  }
}
