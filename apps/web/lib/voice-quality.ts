/**
 * Lógica PURA de qualidade/combinação de amostras de voz — extraída de
 * `voice-profile.ts` (que tem `import 'server-only'` e por isso não pode
 * ser importado direto em teste; mesmo padrão de `voice-similarity.ts`).
 */

export type SampleQuality = 'good' | 'acceptable' | 'insufficient';

export interface SampleQualityReport {
  readonly quality: SampleQuality;
  readonly reason?: string;
}

/** ~10-20s recomendado (Seção 7 do pedido "Participantes") — abaixo disso o embedding fica pouco confiável. */
export const MIN_SAMPLE_MS = 6_000;
export const GOOD_SAMPLE_MS = 10_000;

/**
 * Avaliação de qualidade da amostra ANTES de gerar o embedding. Proxy
 * simples e honesto: duração informada pelo próprio gravador (cliente
 * conhece isso com precisão — não há análise espectral/SNR aqui). Ruído
 * excessivo/múltiplos locutores ficam a cargo da rejeição do próprio
 * serviço de embedding (VAD do Resemblyzer já rejeita trechos sem fala
 * útil).
 */
export function assessSampleQuality(durationMs: number): SampleQualityReport {
  if (durationMs < MIN_SAMPLE_MS) {
    return { quality: 'insufficient', reason: `Fale por pelo menos ${MIN_SAMPLE_MS / 1000}s.` };
  }
  if (durationMs < GOOD_SAMPLE_MS) return { quality: 'acceptable' };
  return { quality: 'good' };
}

/** Média normalizada de N embeddings (3 amostras) — mais robusto que 1 amostra só. */
export function averageEmbeddings(embeddings: readonly (readonly number[])[]): number[] {
  const dim = embeddings[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) sum[i]! += emb[i]!;
  }
  return sum.map((v) => v / embeddings.length);
}
