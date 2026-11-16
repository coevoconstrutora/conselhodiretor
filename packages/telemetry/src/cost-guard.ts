/**
 * Trava de custo por reunião (LLM AO VIVO).
 *
 * Cada chamada ao vivo (conselheiros, estado do caso, case review, roteador,
 * rodada da pauta) reporta seu uso; o medidor converte tokens em US$ pela tabela
 * de preços por modelo e, ao atingir o limite configurado, passa a recusar novas
 * chamadas daquela reunião. NÃO cobre os relatórios finais pós-reunião (ata,
 * síntese, decisões) — esses usam outro caminho e não passam por aqui.
 *
 * Puro (sem rede/segredo/banco): testável direto. Preço e limite chegam por
 * funções, então valem imediatamente quando o dono muda a configuração.
 */

export interface ModelPrice {
  /** US$ por 1M de tokens de entrada (não cacheados). */
  readonly input: number;
  /** US$ por 1M de tokens de entrada lidos do cache de prompt. */
  readonly cachedInput: number;
  /** US$ por 1M de tokens de saída (inclui tokens de raciocínio). */
  readonly output: number;
}

export type ModelPrices = Readonly<Record<string, ModelPrice>>;

/**
 * Preços de referência (US$/1M tokens) — AJUSTÁVEIS pelo dono em /admin/costs.
 * `gpt-5.6-sol` usa a tabela padrão (a OpenAI listava uma promoção mais barata
 * até 21/11/2026): errar para cima só faz a trava disparar mais cedo.
 */
export const DEFAULT_MODEL_PRICES: ModelPrices = {
  'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

/** Modelo desconhecido: assume o preço do mais caro (conservador). */
export function fallbackPrice(prices: ModelPrices): ModelPrice {
  const all = Object.values(prices);
  if (all.length === 0) return DEFAULT_MODEL_PRICES['gpt-5.6-sol']!;
  return all.reduce((max, p) => (p.output > max.output ? p : max));
}

/** Preço do modelo por prefixo mais longo (a API devolve ex.: `gpt-5.6-sol-2026-09-01`). */
export function priceFor(model: string | undefined, prices: ModelPrices): ModelPrice {
  if (model) {
    const name = model.toLowerCase();
    const key = Object.keys(prices)
      .filter((k) => name.startsWith(k.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (key) return prices[key]!;
  }
  return fallbackPrice(prices);
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Parte de `inputTokens` servida do cache (mais barata). */
  readonly cachedInputTokens?: number;
  readonly model?: string;
}

/** Custo em US$ de uma chamada. */
export function usageCostUsd(usage: LlmUsage, prices: ModelPrices): number {
  const p = priceFor(usage.model, prices);
  const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  return (uncached * p.input + cached * p.cachedInput + usage.outputTokens * p.output) / 1_000_000;
}

export class CostLimitReachedError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(
      `Limite de custo da reunião atingido (US$ ${spentUsd.toFixed(2)} de US$ ${limitUsd.toFixed(2)}) — ` +
        'o conselho ao vivo foi pausado; os relatórios finais não são afetados.',
    );
    this.name = 'CostLimitReachedError';
  }
}

export interface MeetingCostGuardOptions {
  /** Limite atual em US$; `<= 0` desativa a trava. Lido a cada checagem (muda sem reiniciar). */
  readonly getLimitUsd: () => Promise<number> | number;
  readonly getPrices: () => Promise<ModelPrices> | ModelPrices;
  /** Disparado uma única vez, quando o limite é atingido. */
  readonly onLimitReached?: (info: { spentUsd: number; limitUsd: number }) => void;
}

export class MeetingCostGuard {
  private spent = 0;
  private calls = 0;
  private limit = 0;
  private notified = false;

  constructor(private readonly opts: MeetingCostGuardOptions) {}

  get spentUsd(): number {
    return this.spent;
  }

  get callCount(): number {
    return this.calls;
  }

  /** Último limite lido (0 = sem limite). */
  get limitUsd(): number {
    return this.limit;
  }

  get reached(): boolean {
    return this.limit > 0 && this.spent >= this.limit;
  }

  /** Soma o custo de uma chamada já feita. Não lança. */
  async record(usage: LlmUsage): Promise<void> {
    const prices = await this.opts.getPrices();
    this.spent += usageCostUsd(usage, prices);
    this.calls += 1;
    await this.refreshLimit();
    this.notifyIfReached();
  }

  /** Lança `CostLimitReachedError` se o limite já foi atingido; chamar ANTES de cada chamada ao LLM. */
  async assertAllowed(): Promise<void> {
    await this.refreshLimit();
    if (this.reached) {
      this.notifyIfReached();
      throw new CostLimitReachedError(this.spent, this.limit);
    }
  }

  private async refreshLimit(): Promise<void> {
    const limit = Number(await this.opts.getLimitUsd());
    this.limit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  }

  private notifyIfReached(): void {
    if (this.reached && !this.notified) {
      this.notified = true;
      this.opts.onLimitReached?.({ spentUsd: this.spent, limitUsd: this.limit });
    }
  }
}

/** Mínimo de `ILlmProvider` que a trava precisa (evita dependência do pacote providers). */
interface GuardableLlm {
  complete(req: never): Promise<unknown>;
  completeText?(req: never): Promise<unknown>;
}

/**
 * Envolve um provider: cada chamada checa o limite antes de ir à API. Estourou ⇒
 * lança `CostLimitReachedError`, que os consumidores ao vivo já tratam como falha
 * da chamada (o board nunca cai por ela).
 */
export function withCostGuard<T extends GuardableLlm>(llm: T, guard: MeetingCostGuard): T {
  const wrapped = {
    ...llm,
    complete: async (req: never) => {
      await guard.assertAllowed();
      return llm.complete(req);
    },
  } as T;
  if (typeof llm.completeText === 'function') {
    (wrapped as GuardableLlm).completeText = async (req: never) => {
      await guard.assertAllowed();
      return llm.completeText!(req);
    };
  }
  return wrapped;
}

/** Limite padrão por reunião (US$) quando nada foi configurado. */
export const DEFAULT_MEETING_COST_LIMIT_USD = 3;

/** Interpreta o limite digitado: número ≥ 0 (0 = sem limite) ou `null` se inválido. */
export function parseCostLimit(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : null;
}

/** Interpreta a tabela de preços (JSON `{modelo:{input,cachedInput,output}}`); `null` se inválida. */
export function parseModelPrices(raw: unknown): ModelPrices | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out: Record<string, ModelPrice> = {};
  for (const [model, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!model.trim() || !value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const input = Number(v.input);
    const cachedInput = Number(v.cachedInput);
    const output = Number(v.output);
    if (![input, cachedInput, output].every((n) => Number.isFinite(n) && n >= 0 && n <= 10_000)) return null;
    out[model.trim()] = { input, cachedInput, output };
  }
  return Object.keys(out).length > 0 ? out : null;
}
