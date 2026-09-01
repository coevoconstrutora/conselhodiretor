import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from './voice-similarity';

describe('cosineSimilarity — limiar de reconhecimento de voz (Tier 3)', () => {
  it('vetores idênticos → similaridade 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
  });

  it('vetores ortogonais → similaridade 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('vetores opostos → similaridade -1', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it('é invariante à escala (só direção importa, não magnitude)', () => {
    const a = [3, 4, 0];
    const b = [6, 8, 0]; // mesma direção, magnitude diferente
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  it('vetores de tamanhos diferentes → 0 (nunca compara embeddings incompatíveis)', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('vetor vazio → 0 (nunca divide por zero)', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('vetor nulo (todo zero) → 0 (nunca divide por zero)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});
