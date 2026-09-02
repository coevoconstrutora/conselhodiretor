import { describe, it, expect } from 'vitest';
import { classifyExperimentResult, parseQualityComparison, EXPERIMENT_ACCEPTANCE_RULES } from './experiments';

describe('classifyExperimentResult — regras de aceitação CENTRALIZADAS (Seção 30)', () => {
  it('sem dado de qualidade ⇒ inconclusive (nunca força um veredito)', () => {
    expect(classifyExperimentResult(null, -0.3)).toBe('inconclusive');
  });

  it('qualidade equivalente + economia relevante ⇒ recommended', () => {
    expect(classifyExperimentResult(-0.3, -0.36)).toBe('recommended');
  });

  it('qualidade melhora fortemente, mesmo sem dado de custo ⇒ recommended', () => {
    expect(classifyExperimentResult(EXPERIMENT_ACCEPTANCE_RULES.strongQualityDelta, null)).toBe('recommended');
  });

  it('qualidade ligeiramente pior, sem economia relevante ⇒ inconclusive', () => {
    expect(classifyExperimentResult(-1, 0)).toBe('inconclusive');
  });

  it('qualidade piora além do limite ⇒ not_recommended', () => {
    expect(classifyExperimentResult(EXPERIMENT_ACCEPTANCE_RULES.minQualityDelta - 0.1, -0.5)).toBe('not_recommended');
  });

  it('qualidade piora MUITO (regressão grave) ⇒ harmful mesmo com economia de custo', () => {
    expect(classifyExperimentResult(EXPERIMENT_ACCEPTANCE_RULES.minQualityDelta * 3, -0.5)).toBe('harmful');
  });

  it('qualidade melhora um pouco, sem custo suficiente ⇒ promising', () => {
    expect(classifyExperimentResult(0.5, -0.02)).toBe('promising');
  });
});

describe('parseQualityComparison — parse defensivo (Seção 14/15)', () => {
  it('extrai scores e nota de um JSON válido', () => {
    const result = parseQualityComparison('{"baseline_score":88,"candidate_score":85,"note":"Equivalente."}');
    expect(result).toEqual({ baselineScore: 88, candidateScore: 85, note: 'Equivalente.' });
  });

  it('aceita cercas de código markdown', () => {
    const result = parseQualityComparison('```json\n{"baseline_score":90,"candidate_score":90,"note":""}\n```');
    expect(result?.baselineScore).toBe(90);
  });

  it('scores fora de 0-100 são grampeados', () => {
    const result = parseQualityComparison('{"baseline_score":150,"candidate_score":-10,"note":""}');
    expect(result?.baselineScore).toBe(100);
    expect(result?.candidateScore).toBe(0);
  });

  it('JSON malformado devolve null — nunca lança', () => {
    expect(parseQualityComparison('não é JSON')).toBeNull();
  });
});
