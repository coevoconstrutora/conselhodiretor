/**
 * Lógica PURA de qualidade/combinação de amostras de voz — extraída de
 * `voice-profile.ts` (que tem `import 'server-only'` e por isso não pode
 * ser importado direto em teste; mesmo padrão de `voice-similarity.ts`).
 */

import { cosineSimilarity } from './voice-similarity';

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

/**
 * Cadastro em 2 rodadas: as mesmas 3 frases lidas duas vezes (6 amostras).
 * Mais amostras = embedding médio mais estável, e a 2ª rodada (em tom um
 * pouco diferente) cobre variação natural da voz entre reuniões.
 */
export const VOICE_PHRASE_COUNT = 3;
export const VOICE_ENROLL_ROUNDS = 2;
export const VOICE_REQUIRED_SAMPLES = VOICE_PHRASE_COUNT * VOICE_ENROLL_ROUNDS;

/** Nível RMS de pico mínimo (0-1) durante a gravação — abaixo disso o microfone quase não captou voz. */
export const MIN_SAMPLE_LEVEL = 0.02;

/** Amostra com cosseno abaixo disto em relação à média é descartada (ruído, tosse, outra pessoa falando). */
export const OUTLIER_SIMILARITY = 0.65;
/** Mínimo de amostras consistentes que precisam sobrar para o perfil ser confiável. */
export const MIN_CONSISTENT_SAMPLES = 4;

export interface EmbeddingConsistency {
  /** Índices das amostras que ficaram (as demais foram descartadas como atípicas). */
  readonly keptIndexes: number[];
  /** Similaridade média das amostras mantidas com o perfil médio (0-1). */
  readonly meanSimilarity: number;
  readonly consistent: boolean;
}

/**
 * Verifica se as amostras são da MESMA voz: compara cada embedding com a
 * média, descarta as atípicas e só aceita o cadastro se sobrarem amostras
 * suficientes. Evita um perfil "contaminado" por uma gravação ruim, que
 * derrubaria a precisão do reconhecimento nas reuniões.
 */
export function analyzeEmbeddingConsistency(embeddings: readonly (readonly number[])[]): EmbeddingConsistency {
  if (embeddings.length === 0) return { keptIndexes: [], meanSimilarity: 0, consistent: false };
  const mean = averageEmbeddings(embeddings);
  const sims = embeddings.map((e) => cosineSimilarity(e, mean));
  const keptIndexes = sims.flatMap((s, i) => (s >= OUTLIER_SIMILARITY ? [i] : []));
  const meanSimilarity =
    keptIndexes.length === 0 ? 0 : keptIndexes.reduce((acc, i) => acc + sims[i]!, 0) / keptIndexes.length;
  return {
    keptIndexes,
    meanSimilarity,
    consistent: keptIndexes.length >= Math.min(MIN_CONSISTENT_SAMPLES, embeddings.length),
  };
}
