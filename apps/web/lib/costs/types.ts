/**
 * Área de custos (Etapa "Custos") — painel só do dono da plataforma
 * (isSuperAdmin) com o gasto real/estimado dos provedores externos que a
 * Coevo paga para operar o produto: Anthropic, OpenAI, Deepgram, Recall.ai
 * e Fly.io. Nada disso é custo do CLIENTE (a empresa que usa o board) — é
 * infraestrutura da operação, por isso fora do escopo de `companyId`.
 */

export type CostKind = 'billed' | 'estimated' | 'unavailable';

export interface CostRange {
  readonly start: Date;
  readonly end: Date;
}

export interface ProviderCostResult {
  readonly providerId: 'anthropic' | 'openai' | 'deepgram' | 'recall' | 'fly';
  readonly label: string;
  /** `null` quando não configurado ou a chamada falhou — nunca 0 por omissão silenciosa. */
  readonly amountUsd: number | null;
  /**
   * 'billed' = valor real da API de billing do provedor; 'estimated' = calculado
   * a partir de uso/recursos + tarifa pública (pode divergir da fatura real);
   * 'unavailable' = sem dado (chave ausente ou chamada falhou — ver `detail`).
   */
  readonly kind: CostKind;
  readonly detail?: string;
}
