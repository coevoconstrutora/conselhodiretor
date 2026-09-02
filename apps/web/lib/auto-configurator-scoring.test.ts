import { describe, it, expect } from 'vitest';
import { computeConfigurationScore, classifyScoreLabel, buildDataSufficiencyNote } from './auto-configurator-scoring';

describe('computeConfigurationScore — Etapa "Auto Configurador", Seção 28', () => {
  it('conselheiro totalmente vazio pontua baixo, mas nunca zero (defaults do produto cobrem)', () => {
    const score = computeConfigurationScore({
      hasProfessionalProfile: false,
      hasDecisionCriteria: false,
      hasRiskPosture: false,
      hasScopeCan: false,
      hasScopeCannot: false,
      kbSourceCount: 0,
      aiModelConfigured: false,
    });
    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThan(60);
  });

  it('conselheiro completo pontua 100', () => {
    const score = computeConfigurationScore({
      hasProfessionalProfile: true,
      hasDecisionCriteria: true,
      hasRiskPosture: true,
      hasScopeCan: true,
      hasScopeCannot: true,
      kbSourceCount: 5,
      aiModelConfigured: true,
    });
    expect(score.overall).toBe(100);
  });

  it('mais fontes de conhecimento aumenta o score, com teto em 100', () => {
    const base = { hasProfessionalProfile: true, hasDecisionCriteria: true, hasRiskPosture: true, hasScopeCan: true, hasScopeCannot: true, aiModelConfigured: true };
    expect(computeConfigurationScore({ ...base, kbSourceCount: 1 }).knowledge).toBeLessThan(
      computeConfigurationScore({ ...base, kbSourceCount: 4 }).knowledge,
    );
    expect(computeConfigurationScore({ ...base, kbSourceCount: 100 }).knowledge).toBe(100);
  });
});

describe('classifyScoreLabel — faixas da Seção 29', () => {
  it('90+ é bem configurado, 75-89 boa configuração, 60-74 revisão recomendada, <60 incompleta', () => {
    expect(classifyScoreLabel(95)).toBe('bem_configurado');
    expect(classifyScoreLabel(80)).toBe('boa_configuracao');
    expect(classifyScoreLabel(65)).toBe('revisao_recomendada');
    expect(classifyScoreLabel(40)).toBe('incompleta');
  });
});

describe('buildDataSufficiencyNote — nunca mais confiança do que os dados sustentam (Seção 64)', () => {
  it('sem reuniões: nota honesta sobre falta de histórico', () => {
    expect(buildDataSufficiencyNote(0)).toContain('sem histórico de reuniões');
  });

  it('poucas reuniões: qualifica como sinal inicial', () => {
    expect(buildDataSufficiencyNote(2)).toContain('sinal inicial');
  });

  it('reuniões suficientes: cita a contagem real', () => {
    expect(buildDataSufficiencyNote(32)).toContain('32 reuniões históricas');
  });
});
