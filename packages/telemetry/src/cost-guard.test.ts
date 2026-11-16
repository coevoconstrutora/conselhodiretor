import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_MODEL_PRICES,
  MeetingCostGuard,
  CostLimitReachedError,
  priceFor,
  usageCostUsd,
  withCostGuard,
  parseCostLimit,
  parseModelPrices,
} from './cost-guard';

describe('priceFor / usageCostUsd', () => {
  it('casa o modelo versionado pelo prefixo mais longo', () => {
    expect(priceFor('gpt-5.6-sol-2026-09-01', DEFAULT_MODEL_PRICES).output).toBe(30);
    expect(priceFor('gpt-5.6-luna', DEFAULT_MODEL_PRICES).output).toBe(1.2);
  });

  it('modelo desconhecido assume o preço do mais caro (conservador)', () => {
    expect(priceFor('modelo-novo', DEFAULT_MODEL_PRICES).output).toBe(30);
    expect(priceFor(undefined, DEFAULT_MODEL_PRICES).output).toBe(30);
  });

  it('cobra o cache mais barato e a saída ao preço de saída', () => {
    // sol: 1M entrada (900k em cache) + 100k saída
    const usd = usageCostUsd(
      { model: 'gpt-5.6-sol', inputTokens: 1_000_000, cachedInputTokens: 900_000, outputTokens: 100_000 },
      DEFAULT_MODEL_PRICES,
    );
    expect(usd).toBeCloseTo(0.1 * 5 + 0.9 * 0.5 + 0.1 * 30, 6); // 3.95
  });

  it('cache maior que a entrada é limitado à entrada', () => {
    const usd = usageCostUsd(
      { model: 'gpt-5.6-luna', inputTokens: 1000, cachedInputTokens: 5000, outputTokens: 0 },
      DEFAULT_MODEL_PRICES,
    );
    expect(usd).toBeCloseTo((1000 * 0.02) / 1_000_000, 10);
  });
});

describe('MeetingCostGuard', () => {
  const make = (limit: number, onLimitReached?: () => void) =>
    new MeetingCostGuard({ getLimitUsd: () => limit, getPrices: () => DEFAULT_MODEL_PRICES, onLimitReached });

  it('permite chamadas abaixo do limite', async () => {
    const guard = make(3);
    await guard.record({ model: 'gpt-5.6-luna', inputTokens: 10_000, outputTokens: 1_000 });
    await expect(guard.assertAllowed()).resolves.toBeUndefined();
    expect(guard.reached).toBe(false);
  });

  it('trava depois de atingir o limite e avisa uma única vez', async () => {
    const onLimitReached = vi.fn();
    const guard = make(1, onLimitReached);
    // 50k tokens de saída em sol = US$ 1,50 > US$ 1
    await guard.record({ model: 'gpt-5.6-sol', inputTokens: 0, outputTokens: 50_000 });
    await expect(guard.assertAllowed()).rejects.toBeInstanceOf(CostLimitReachedError);
    await expect(guard.assertAllowed()).rejects.toBeInstanceOf(CostLimitReachedError);
    expect(guard.reached).toBe(true);
    expect(onLimitReached).toHaveBeenCalledTimes(1);
  });

  it('limite 0 desativa a trava', async () => {
    const guard = make(0);
    await guard.record({ model: 'gpt-5.6-sol', inputTokens: 0, outputTokens: 5_000_000 });
    await expect(guard.assertAllowed()).resolves.toBeUndefined();
    expect(guard.reached).toBe(false);
  });

  it('mudança de limite vale na próxima checagem, sem reiniciar', async () => {
    let limit = 1;
    const guard = new MeetingCostGuard({ getLimitUsd: () => limit, getPrices: () => DEFAULT_MODEL_PRICES });
    await guard.record({ model: 'gpt-5.6-sol', inputTokens: 0, outputTokens: 50_000 }); // US$ 1,50
    await expect(guard.assertAllowed()).rejects.toBeInstanceOf(CostLimitReachedError);
    limit = 10;
    await expect(guard.assertAllowed()).resolves.toBeUndefined();
  });
});

describe('withCostGuard', () => {
  it('bloqueia complete e completeText depois do limite, sem chamar o provider', async () => {
    const llm = { complete: vi.fn(async () => 'c'), completeText: vi.fn(async () => 't') };
    const guard = new MeetingCostGuard({ getLimitUsd: () => 1, getPrices: () => DEFAULT_MODEL_PRICES });
    const guarded = withCostGuard(llm as never as { complete(req: never): Promise<unknown>; completeText(req: never): Promise<unknown> }, guard);

    await expect(guarded.complete(undefined as never)).resolves.toBe('c');
    await guard.record({ model: 'gpt-5.6-sol', inputTokens: 0, outputTokens: 50_000 });

    await expect(guarded.complete(undefined as never)).rejects.toBeInstanceOf(CostLimitReachedError);
    await expect(guarded.completeText!(undefined as never)).rejects.toBeInstanceOf(CostLimitReachedError);
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.completeText).not.toHaveBeenCalled();
  });

  it('provider sem completeText continua sem completeText', () => {
    const guard = new MeetingCostGuard({ getLimitUsd: () => 1, getPrices: () => DEFAULT_MODEL_PRICES });
    const guarded = withCostGuard({ complete: async () => 'x' } as never as { complete(req: never): Promise<unknown>; completeText?(req: never): Promise<unknown> }, guard);
    expect(guarded.completeText).toBeUndefined();
  });
});

describe('parseCostLimit / parseModelPrices', () => {
  it('aceita número, vírgula decimal e zero; rejeita inválidos', () => {
    expect(parseCostLimit('3')).toBe(3);
    expect(parseCostLimit('2,5')).toBe(2.5);
    expect(parseCostLimit('0')).toBe(0);
    expect(parseCostLimit('')).toBeNull();
    expect(parseCostLimit('abc')).toBeNull();
    expect(parseCostLimit('-1')).toBeNull();
  });

  it('valida a tabela de preços', () => {
    const ok = parseModelPrices('{"m":{"input":1,"cachedInput":0.1,"output":5}}');
    expect(ok).toEqual({ m: { input: 1, cachedInput: 0.1, output: 5 } });
    expect(parseModelPrices('{"m":{"input":1}}')).toBeNull();
    expect(parseModelPrices('não é json')).toBeNull();
    expect(parseModelPrices('{}')).toBeNull();
    expect(parseModelPrices('[]')).toBeNull();
  });
});
