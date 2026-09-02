import { describe, it, expect } from 'vitest';
import { buildBriefingPrompt, generateAgentBriefing, BRIEFING_MAX, type BriefingProfileInput } from './agent-briefing';

const BASE: BriefingProfileInput = {
  displayName: 'CFO — Funding, Caixa e MCMV',
  scopeCan: 'fluxo de caixa e exposição, funding e financiamento à produção',
  scopeCannot: '',
  professionalProfile: null,
  decisionCriteria: null,
  riskPosture: null,
  riskPostureNotes: null,
};

describe('buildBriefingPrompt', () => {
  it('inclui nome e o que o conselheiro cobre', () => {
    const prompt = buildBriefingPrompt(BASE);
    expect(prompt).toContain('Nome: CFO — Funding, Caixa e MCMV');
    expect(prompt).toContain('Cobre: fluxo de caixa e exposição');
  });

  it('inclui o que NÃO cobre só quando preenchido', () => {
    expect(buildBriefingPrompt(BASE)).not.toContain('NÃO cobre');
    expect(buildBriefingPrompt({ ...BASE, scopeCannot: 'engenharia' })).toContain('NÃO cobre: engenharia');
  });

  it('inclui perfil profissional e critérios de decisão quando preenchidos', () => {
    const prompt = buildBriefingPrompt({
      ...BASE,
      professionalProfile: '15 anos em finanças corporativas',
      decisionCriteria: 'previsibilidade de caixa acima de tudo',
    });
    expect(prompt).toContain('Perfil profissional: 15 anos em finanças corporativas');
    expect(prompt).toContain('Prioriza ao avaliar: previsibilidade de caixa acima de tudo');
  });

  it('inclui postura de risco traduzida + notas, só quando definida', () => {
    expect(buildBriefingPrompt(BASE)).not.toContain('Postura de risco');
    const prompt = buildBriefingPrompt({
      ...BASE,
      riskPosture: 'conservative',
      riskPostureNotes: 'evita alavancagem',
    });
    expect(prompt).toContain('Postura de risco: conservadora (evita alavancagem)');
  });
});

describe('generateAgentBriefing', () => {
  it('devolve o texto gerado, sem aspas nas pontas', async () => {
    const llm = { complete: async () => { throw new Error('não deveria chamar complete'); }, completeText: async () => ({ text: '"Cuida do caixa e do funding."' }) };
    const briefing = await generateAgentBriefing(llm, BASE);
    expect(briefing).toBe('Cuida do caixa e do funding.');
  });

  it('corta no limite de caracteres mesmo se o modelo estourar', async () => {
    const long = 'x'.repeat(BRIEFING_MAX + 50);
    const llm = { complete: async () => { throw new Error('não deveria chamar complete'); }, completeText: async () => ({ text: long }) };
    const briefing = await generateAgentBriefing(llm, BASE);
    expect(briefing.length).toBe(BRIEFING_MAX);
  });

  it('lança se o texto gerado vier vazio', async () => {
    const llm = { complete: async () => { throw new Error('não deveria chamar complete'); }, completeText: async () => ({ text: '   ' }) };
    await expect(generateAgentBriefing(llm, BASE)).rejects.toThrow(/não devolveu texto/);
  });

  it('lança uma mensagem clara se o provedor não suportar completeText (fake/legado)', async () => {
    const llm = { complete: async () => { throw new Error('não deveria chamar complete'); } };
    await expect(generateAgentBriefing(llm, BASE)).rejects.toThrow(/não suporta geração de texto/);
  });
});
