import { describe, it, expect } from 'vitest';
import {
  sumAnthropicCostUsd,
  sumOpenAiCostUsd,
  sumDeepgramCostUsd,
  estimateRecallCostUsd,
  estimateFlyMonthlyCostUsd,
  scaleMonthlyToRangeUsd,
} from './calc';

describe('sumAnthropicCostUsd — cost_report.amount vem em centavos', () => {
  it('soma amount de todos os buckets/results e converte centavos para USD', () => {
    const total = sumAnthropicCostUsd([
      { results: [{ amount: '150.5' }] },
      { results: [{ amount: '49.5' }, { amount: '100' }] },
    ]);
    expect(total).toBeCloseTo(3.0, 5); // 300 centavos = US$3
  });

  it('bucket sem results (nenhum custo naquele dia) não quebra a soma', () => {
    expect(sumAnthropicCostUsd([{ results: [] }])).toBe(0);
  });
});

describe('sumOpenAiCostUsd — Costs API já devolve amount.value em USD', () => {
  it('soma amount.value de todos os buckets/results', () => {
    const total = sumOpenAiCostUsd([
      { results: [{ amount: { value: 0.13 } }] },
      { results: [{ amount: { value: 0.07 } }] },
    ]);
    expect(total).toBeCloseTo(0.2, 5);
  });
});

describe('sumDeepgramCostUsd — billing breakdown já devolve dollars', () => {
  it('soma dollars de todas as linhas', () => {
    expect(sumDeepgramCostUsd([{ dollars: 1.5 }, { dollars: 2.25 }])).toBeCloseTo(3.75, 5);
  });
});

describe('estimateRecallCostUsd — a API só devolve segundos, não US$', () => {
  it('converte segundos em horas × tarifa', () => {
    expect(estimateRecallCostUsd(7200, 0.5)).toBeCloseTo(1.0, 5); // 2h * 0.50
  });
});

describe('estimateFlyMonthlyCostUsd — sem API de billing, estima por máquina ativa', () => {
  it('ignora máquinas paradas e as de CPU dedicada (sem tarifa confiável)', () => {
    const result = estimateFlyMonthlyCostUsd([
      { state: 'started', config: { guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 } } },
      { state: 'stopped', config: { guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 } } },
      { state: 'started', config: { guest: { cpu_kind: 'performance', cpus: 2, memory_mb: 4096 } } },
    ]);
    // 1 vCPU (1.94) + 0.75GB extra (1024-256=768MB) * 5/GB = 1.94 + 3.75 = 5.69
    expect(result.monthlyUsd).toBeCloseTo(5.69, 2);
    expect(result.runningCount).toBe(2); // conta as 2 "started", inclusive a não coberta
    expect(result.uncoveredCount).toBe(1);
  });

  it('shared-cpu-1x com 256MB (sem RAM extra) custa só a tarifa base do vCPU', () => {
    const result = estimateFlyMonthlyCostUsd([
      { state: 'started', config: { guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 256 } } },
    ]);
    expect(result.monthlyUsd).toBeCloseTo(1.94, 5);
    expect(result.uncoveredCount).toBe(0);
  });
});

describe('scaleMonthlyToRangeUsd', () => {
  it('30 dias devolve ~o valor mensal cheio', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-31T00:00:00Z');
    expect(scaleMonthlyToRangeUsd(30, start, end)).toBeCloseTo(30, 5);
  });

  it('período de 1 dia devolve 1/30 do valor mensal', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-02T00:00:00Z');
    expect(scaleMonthlyToRangeUsd(30, start, end)).toBeCloseTo(1, 5);
  });
});
