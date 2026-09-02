import { describe, it, expect } from 'vitest';
import { assessSampleQuality, averageEmbeddings, MIN_SAMPLE_MS, GOOD_SAMPLE_MS } from './voice-quality';

describe('assessSampleQuality — proxy de duração (Etapa "Participantes", Seção 7)', () => {
  it('classifica insuficiente abaixo do mínimo', () => {
    const result = assessSampleQuality(MIN_SAMPLE_MS - 1);
    expect(result.quality).toBe('insufficient');
    expect(result.reason).toBeTruthy();
  });

  it('classifica aceitável entre o mínimo e o alvo', () => {
    expect(assessSampleQuality(MIN_SAMPLE_MS).quality).toBe('acceptable');
    expect(assessSampleQuality(GOOD_SAMPLE_MS - 1).quality).toBe('acceptable');
  });

  it('classifica boa a partir do alvo', () => {
    expect(assessSampleQuality(GOOD_SAMPLE_MS).quality).toBe('good');
    expect(assessSampleQuality(20_000).quality).toBe('good');
  });
});

describe('averageEmbeddings — combina N amostras (Seção 8)', () => {
  it('devolve a média elemento-a-elemento', () => {
    expect(averageEmbeddings([[1, 2, 3], [3, 4, 5]])).toEqual([2, 3, 4]);
  });

  it('1 amostra só devolve ela mesma', () => {
    expect(averageEmbeddings([[1, 2, 3]])).toEqual([1, 2, 3]);
  });
});
