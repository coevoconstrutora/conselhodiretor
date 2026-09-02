import { describe, it, expect } from 'vitest';
import {
  scoreDecisionClarity,
  scoreActionItemQuality,
  scoreRedundancyControl,
  computeOverallScore,
  SCORE_WEIGHTS,
} from './analysis-scoring';

describe('scoreDecisionClarity — Etapa "Auto-análise", Seção 11', () => {
  it('null sem decisões (nunca 0 — ausência de dado é diferente de nota zero)', () => {
    expect(scoreDecisionClarity([])).toBeNull();
  });

  it('decisão completa (responsável + evidência + prazo) pontua 100', () => {
    expect(
      scoreDecisionClarity([{ responsible: 'Carlos', deadline: new Date(), evidence: 'Proposta aprovada' }]),
    ).toBe(100);
  });

  it('decisão sem responsável nem prazo pontua só a evidência (40)', () => {
    expect(scoreDecisionClarity([{ responsible: '', deadline: null, evidence: 'Discutido em ata' }])).toBe(40);
  });
});

describe('scoreActionItemQuality — Seção 12', () => {
  it('null sem ações', () => {
    expect(scoreActionItemQuality([])).toBeNull();
  });

  it('responsável + prazo pontua 100', () => {
    expect(scoreActionItemQuality([{ responsible: 'Jurídico', deadline: new Date() }])).toBe(100);
  });

  it('só responsável pontua 50', () => {
    expect(scoreActionItemQuality([{ responsible: 'Jurídico', deadline: null }])).toBe(50);
  });
});

describe('scoreRedundancyControl — Seção 9 (medido pelo gate, não estimado)', () => {
  it('null sem candidatos', () => {
    expect(scoreRedundancyControl(0, 0)).toBeNull();
  });

  it('sem duplicatas pontua 100', () => {
    expect(scoreRedundancyControl(10, 0)).toBe(100);
  });

  it('metade duplicada pontua 50', () => {
    expect(scoreRedundancyControl(10, 5)).toBe(50);
  });
});

describe('computeOverallScore — pesos centralizados (Seção 5)', () => {
  it('null quando NENHUMA dimensão está disponível', () => {
    expect(
      computeOverallScore({
        counselorRelevance: null,
        routingQuality: null,
        suggestionQuality: null,
        redundancyControl: null,
        presidentQuality: null,
        decisionClarity: null,
        actionItemQuality: null,
        knowledgeGrounding: null,
        meetingContinuity: null,
      }),
    ).toBeNull();
  });

  it('dimensão ausente é EXCLUÍDA do cálculo, não tratada como 0', () => {
    const allEighty = {
      counselorRelevance: 80,
      routingQuality: 80,
      suggestionQuality: 80,
      redundancyControl: 80,
      presidentQuality: 80,
      decisionClarity: 80,
      actionItemQuality: 80,
      knowledgeGrounding: 80,
      meetingContinuity: null, // sem reunião anterior — não deveria puxar a média pra baixo
    };
    expect(computeOverallScore(allEighty)).toBe(80);
  });

  it('todas as dimensões em 100 dá overall 100', () => {
    const allHundred = Object.fromEntries(Object.keys(SCORE_WEIGHTS).map((k) => [k, 100])) as Record<
      keyof typeof SCORE_WEIGHTS,
      number
    >;
    expect(computeOverallScore(allHundred)).toBe(100);
  });
});
