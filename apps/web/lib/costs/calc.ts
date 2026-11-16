/**
 * Matemática PURA da área de custos, separada dos clients de rede (que têm
 * `import 'server-only'` e por isso não podem ser testados diretamente pelo
 * Vitest — mesma limitação de qualquer outro arquivo `server-only` deste
 * projeto). Nenhuma função aqui toca rede/segredo — só soma o que a API de
 * cada provedor já devolveu.
 */

import type { CostBreakdown } from './types';

export interface CostReportBucket {
  readonly results: ReadonlyArray<{ readonly amount: string }>;
}

/** Anthropic cost_report: `amount` vem em CENTAVOS como string decimal — devolve em USD. */
export function sumAnthropicCostUsd(buckets: readonly CostReportBucket[]): number {
  let cents = 0;
  for (const bucket of buckets) {
    for (const r of bucket.results) cents += Number.parseFloat(r.amount) || 0;
  }
  return cents / 100;
}

export interface OpenAiCostBucket {
  /** Início do bucket diário (segundos Unix, UTC). */
  readonly start_time?: number;
  readonly results: ReadonlyArray<{
    readonly amount: { readonly value: number };
    /** Presente quando a consulta usa `group_by=line_item` (ex.: "modelo, tipo de token"). */
    readonly line_item?: string | null;
  }>;
}

const NO_LINE_ITEM_LABEL = '(sem detalhe)';

/**
 * Agrega a Costs API da OpenAI por item faturado e por dia. Puro: o rótulo do
 * item é o `line_item` que a API devolveu, sem interpretação.
 */
export function breakdownOpenAiCost(buckets: readonly OpenAiCostBucket[]): CostBreakdown {
  const items = new Map<string, number>();
  const days = new Map<string, number>();
  for (const bucket of buckets) {
    const day =
      typeof bucket.start_time === 'number' ? new Date(bucket.start_time * 1000).toISOString().slice(0, 10) : null;
    if (day && !days.has(day)) days.set(day, 0);
    for (const r of bucket.results) {
      const label = r.line_item?.trim() || NO_LINE_ITEM_LABEL;
      items.set(label, (items.get(label) ?? 0) + r.amount.value);
      if (day) days.set(day, (days.get(day) ?? 0) + r.amount.value);
    }
  }
  return {
    byItem: [...items.entries()]
      .filter(([, usd]) => usd > 0)
      .map(([label, usd]) => ({ label, usd }))
      .sort((a, b) => b.usd - a.usd),
    byDay: [...days.entries()].map(([label, usd]) => ({ label, usd })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** OpenAI Costs API: `amount.value` já vem em USD. */
export function sumOpenAiCostUsd(buckets: readonly OpenAiCostBucket[]): number {
  let usd = 0;
  for (const bucket of buckets) {
    for (const r of bucket.results) usd += r.amount.value;
  }
  return usd;
}

/** Deepgram billing breakdown: `dollars` já vem em USD por linha. */
export function sumDeepgramCostUsd(results: ReadonlyArray<{ readonly dollars: number }>): number {
  return results.reduce((sum, r) => sum + r.dollars, 0);
}

/** Recall.ai só devolve segundos de bot — o valor em US$ é sempre uma estimativa nossa. */
export function estimateRecallCostUsd(botTotalSeconds: number, hourlyRateUsd: number): number {
  return (botTotalSeconds / 3600) * hourlyRateUsd;
}

export interface FlyMachine {
  readonly state: string;
  readonly config?: {
    readonly guest?: { readonly cpu_kind?: string; readonly cpus?: number; readonly memory_mb?: number };
  };
}

export interface FlyEstimate {
  readonly monthlyUsd: number;
  readonly runningCount: number;
  readonly uncoveredCount: number;
}

const SHARED_CPU_MONTHLY_USD = 1.94;
const EXTRA_RAM_GB_MONTHLY_USD = 5;
const INCLUDED_RAM_MB_PER_CPU = 256;

/**
 * Estimativa (não fatura real — a Fly não publica API de billing): só
 * máquinas `started` com `cpu_kind: 'shared'` entram na conta (CPU dedicada
 * tem tarifa própria não coberta aqui, fica em `uncoveredCount`).
 */
export function estimateFlyMonthlyCostUsd(machines: readonly FlyMachine[]): FlyEstimate {
  const running = machines.filter((m) => m.state === 'started');
  let monthlyUsd = 0;
  let uncoveredCount = 0;
  for (const m of running) {
    const guest = m.config?.guest;
    if (!guest || guest.cpu_kind !== 'shared') {
      uncoveredCount += 1;
      continue;
    }
    const cpus = guest.cpus ?? 1;
    const memoryMb = guest.memory_mb ?? 256;
    const includedMb = INCLUDED_RAM_MB_PER_CPU * cpus;
    const extraRamGb = Math.max(0, (memoryMb - includedMb) / 1024);
    monthlyUsd += SHARED_CPU_MONTHLY_USD * cpus + extraRamGb * EXTRA_RAM_GB_MONTHLY_USD;
  }
  return { monthlyUsd, runningCount: running.length, uncoveredCount };
}

/** Escala um custo mensal estimado para o número de dias de um período. */
export function scaleMonthlyToRangeUsd(monthlyUsd: number, rangeStart: Date, rangeEnd: Date): number {
  const days = Math.max(1, (rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000));
  return (monthlyUsd / 30) * days;
}
