import 'server-only';
import type { CostRange, ProviderCostResult } from './types';
import { sumDeepgramCostUsd } from './calc';

/**
 * Deepgram Billing Breakdown (developers.deepgram.com/reference/manage/billing/breakdown)
 * — reusa a mesma DEEPGRAM_API_KEY já configurada para transcrição ao vivo
 * (não precisa de uma chave "admin" separada, diferente de Anthropic/OpenAI).
 * Precisa do project_id: descoberto via /v1/projects (primeiro projeto) se
 * DEEPGRAM_PROJECT_ID não for informado.
 */
const API_BASE = 'https://api.deepgram.com/v1';

interface ProjectsResponse {
  readonly projects: ReadonlyArray<{ readonly project_id: string; readonly name?: string }>;
}
interface BillingBreakdownResponse {
  readonly results: ReadonlyArray<{ readonly dollars: number }>;
}

async function resolveProjectId(headers: HeadersInit): Promise<string | null> {
  if (process.env.DEEPGRAM_PROJECT_ID) return process.env.DEEPGRAM_PROJECT_ID;
  const res = await fetch(`${API_BASE}/projects`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json()) as ProjectsResponse;
  return json.projects[0]?.project_id ?? null;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getDeepgramCost(range: CostRange): Promise<ProviderCostResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return {
      providerId: 'deepgram',
      label: 'Deepgram',
      amountUsd: null,
      kind: 'unavailable',
      detail: 'DEEPGRAM_API_KEY não configurada.',
    };
  }
  const headers: HeadersInit = { authorization: `Token ${apiKey}` };
  try {
    const projectId = await resolveProjectId(headers);
    if (!projectId) {
      return {
        providerId: 'deepgram',
        label: 'Deepgram',
        amountUsd: null,
        kind: 'unavailable',
        detail: 'Nenhum projeto Deepgram encontrado para esta chave.',
      };
    }
    const params = new URLSearchParams({ start: toDateOnly(range.start), end: toDateOnly(range.end) });
    const res = await fetch(`${API_BASE}/projects/${projectId}/billing/breakdown?${params.toString()}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as BillingBreakdownResponse;
    return { providerId: 'deepgram', label: 'Deepgram', amountUsd: sumDeepgramCostUsd(json.results), kind: 'billed' };
  } catch (err) {
    return {
      providerId: 'deepgram',
      label: 'Deepgram',
      amountUsd: null,
      kind: 'unavailable',
      detail: err instanceof Error ? err.message : 'Falha ao consultar o billing breakdown da Deepgram.',
    };
  }
}
