import 'server-only';
import type { CostRange, ProviderCostResult } from './types';
import { sumAnthropicCostUsd, type CostReportBucket } from './calc';

/**
 * Usage & Cost Admin API (https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
 * — exige uma Admin API key (sk-ant-admin...), DIFERENTE da ANTHROPIC_API_KEY
 * usada pelo board para gerar relatórios. Cost report é só granularidade
 * diária (`bucket_width=1d`), no máximo 31 buckets por página — pagina com
 * `has_more`/`next_page` quando o intervalo pedido for maior.
 */
const COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';

interface CostReportResponse {
  readonly data: readonly CostReportBucket[];
  readonly has_more: boolean;
  readonly next_page: string | null;
}

export async function getAnthropicCost(range: CostRange): Promise<ProviderCostResult> {
  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) {
    return {
      providerId: 'anthropic',
      label: 'Anthropic (Claude)',
      amountUsd: null,
      kind: 'unavailable',
      detail: 'ANTHROPIC_ADMIN_API_KEY não configurada (Admin API key, diferente da chave normal do board).',
    };
  }
  try {
    let totalUsd = 0;
    let page: string | null = null;
    do {
      const params = new URLSearchParams({
        starting_at: range.start.toISOString(),
        ending_at: range.end.toISOString(),
        limit: '31',
      });
      if (page) params.set('page', page);
      const res = await fetch(`${COST_REPORT_URL}?${params.toString()}`, {
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as CostReportResponse;
      totalUsd += sumAnthropicCostUsd(json.data);
      page = json.has_more ? json.next_page : null;
    } while (page);
    return { providerId: 'anthropic', label: 'Anthropic (Claude)', amountUsd: totalUsd, kind: 'billed' };
  } catch (err) {
    return {
      providerId: 'anthropic',
      label: 'Anthropic (Claude)',
      amountUsd: null,
      kind: 'unavailable',
      detail: err instanceof Error ? err.message : 'Falha ao consultar o cost report da Anthropic.',
    };
  }
}
