import { describe, it, expect } from 'vitest';
import {
  analyzeEmbeddingConsistency,
  VOICE_REQUIRED_SAMPLES,
  VOICE_PHRASE_COUNT,
  VOICE_ENROLL_ROUNDS,
} from './voice-quality';

describe('cadastro em 2 rodadas', () => {
  it('exige 3 frases × 2 rodadas', () => {
    expect(VOICE_REQUIRED_SAMPLES).toBe(VOICE_PHRASE_COUNT * VOICE_ENROLL_ROUNDS);
    expect(VOICE_REQUIRED_SAMPLES).toBe(6);
  });
});

describe('analyzeEmbeddingConsistency — descarta amostra atípica', () => {
  const voice = (noise: number) => [1, 0.9 + noise, 0.8, 0.1, 0.05, 0.02];
  const sameVoice = [voice(0), voice(0.02), voice(-0.02), voice(0.01), voice(-0.01)];
  const other = [-0.2, 0.1, -0.9, 1, 1, 0.9]; // outra pessoa / ruído

  it('amostras da mesma voz: mantém todas', () => {
    const r = analyzeEmbeddingConsistency(sameVoice);
    expect(r.consistent).toBe(true);
    expect(r.keptIndexes).toHaveLength(5);
    expect(r.meanSimilarity).toBeGreaterThan(0.95);
  });

  it('uma amostra de outra voz é descartada e o perfil continua válido', () => {
    const r = analyzeEmbeddingConsistency([...sameVoice, other]);
    expect(r.consistent).toBe(true);
    expect(r.keptIndexes).not.toContain(5);
    expect(r.keptIndexes).toHaveLength(5);
  });

  it('vozes misturadas demais: recusa o cadastro', () => {
    // 6 vetores sem nenhuma relação entre si (6 "vozes" diferentes)
    const unrelated = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (__, j) => (i === j ? 1 : 0)));
    const r = analyzeEmbeddingConsistency(unrelated);
    expect(r.consistent).toBe(false);
  });

  it('sem amostras: inconsistente', () => {
    expect(analyzeEmbeddingConsistency([]).consistent).toBe(false);
  });
});
