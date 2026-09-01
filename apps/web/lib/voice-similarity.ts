/**
 * Similaridade de cosseno — separada de voice-profile.ts (que é server-only)
 * para ser testável por unidade, mesmo padrão de text-extract.ts/kb-sources.ts.
 */

/** Similaridade de cosseno — 1 = idêntico, 0 = ortogonal/sem relação, -1 = oposto. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
