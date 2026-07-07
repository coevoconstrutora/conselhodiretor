import { describe, it, expect } from 'vitest';
import { keywordSet, jaccard, SemanticDeduplicator } from './semantic-dedup';

describe('keywordSet (B2 — vocabulário normalizado pt-BR)', () => {
  it('remove acentos, stopwords e palavras curtas', () => {
    const words = keywordSet('Vale checar a pressão arterial e a frequência do paciente');
    expect(words.has('pressao')).toBe(true);
    expect(words.has('arterial')).toBe(true);
    expect(words.has('frequencia')).toBe(true);
    expect(words.has('vale')).toBe(false); // stopword de tom
    expect(words.has('checar')).toBe(false);
    expect(words.has('paciente')).toBe(false);
    expect(words.has('a')).toBe(false);
  });

  it('é estável a caixa e pontuação', () => {
    expect(keywordSet('PLATÔ no peso!')).toEqual(keywordSet('platô, no peso'));
  });
});

describe('jaccard', () => {
  it('idênticos = 1, disjuntos = 0', () => {
    const a = new Set(['tsh', 'tireoide']);
    expect(jaccard(a, new Set(['tsh', 'tireoide']))).toBe(1);
    expect(jaccard(a, new Set(['ldl', 'estatina']))).toBe(0);
  });

  it('parcial: interseção / união', () => {
    expect(jaccard(new Set(['a1', 'b1', 'c1']), new Set(['b1', 'c1', 'd1']))).toBeCloseTo(0.5);
  });
});

describe('SemanticDeduplicator (consulta inteira, sem janela de tempo)', () => {
  it('paráfrase clínica realista é pega como duplicata', () => {
    const dedup = new SemanticDeduplicator();
    dedup.register('Vale investigar função tireoidiana: TSH e T4 livre diante do platô com cansaço.');
    const result = dedup.isDuplicate(
      'Considere solicitar TSH e T4 livre — o platô com cansaço sugere investigar a função tireoidiana.',
    );
    expect(result.duplicate).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('tema NOVO não é pego', () => {
    const dedup = new SemanticDeduplicator();
    dedup.register('Vale investigar função tireoidiana: TSH e T4 livre.');
    const result = dedup.isDuplicate('Considere avaliar o perfil lipídico: LDL e triglicerídeos antes da estatina.');
    expect(result.duplicate).toBe(false);
  });

  it('compara contra TODOS os anteriores (não só o último)', () => {
    const dedup = new SemanticDeduplicator();
    dedup.register('Investigar TSH e T4 livre pelo platô.');
    dedup.register('Avaliar perfil lipídico LDL.');
    expect(dedup.isDuplicate('Vale investigar TSH e T4 livre pelo platô no peso.').duplicate).toBe(true);
  });
});
