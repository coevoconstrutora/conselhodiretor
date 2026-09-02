import { describe, it, expect } from 'vitest';
import { getAgentEmoji, buildQuickBriefing, splitNameArea, buildAgentRoster } from './agent-display';

describe('getAgentEmoji', () => {
  it('devolve o emoji curado dos 9 padrão', () => {
    expect(getAgentEmoji('cfo')).toBe('💰');
    expect(getAgentEmoji('presidente')).toBe('⭐');
  });

  it('cai no genérico para um agentId custom desconhecido', () => {
    expect(getAgentEmoji('rh-e-cultura')).toBe('🧑‍💼');
  });
});

describe('buildQuickBriefing', () => {
  it('devolve o escopo inteiro quando já cabe no limite', () => {
    expect(buildQuickBriefing('custos e orçamento de obra')).toBe('custos e orçamento de obra');
  });

  it('corta na última palavra completa antes do limite, sem cortar no meio', () => {
    const scope =
      'custos e orçamento de obra, cronograma e caminho crítico, produtividade, método construtivo, insumos (INCC/CUB), gestão de empreiteiras e lean construction';
    const briefing = buildQuickBriefing(scope, 60);
    expect(briefing.length).toBeLessThanOrEqual(61); // 60 + "…"
    expect(briefing.endsWith('…')).toBe(true);
    expect(briefing).not.toMatch(/\w…$/); // não corta no meio de uma palavra
  });

  it('normaliza espaços múltiplos/quebras de linha antes de medir o limite', () => {
    expect(buildQuickBriefing('a   b\n\nc', 10)).toBe('a b c');
  });
});

describe('splitNameArea', () => {
  it('separa "Nome — Área" no travessão', () => {
    expect(splitNameArea('CFO — Funding, Caixa e MCMV')).toEqual({
      name: 'CFO',
      area: 'Funding, Caixa e MCMV',
    });
  });

  it('aceita hífen simples como separador', () => {
    expect(splitNameArea('CS - Customer Success')).toEqual({ name: 'CS', area: 'Customer Success' });
  });

  it('sem separador, área fica vazia e nome é o texto inteiro', () => {
    expect(splitNameArea('RH e Cultura')).toEqual({ name: 'RH e Cultura', area: '' });
  });
});

describe('buildAgentRoster', () => {
  it('coloca o Presidente por último, mesmo que ele não seja o último no registry', () => {
    const profiles = {
      presidente: { agentId: 'presidente', displayName: 'Presidente do Conselho', scope: 'síntese' },
      cfo: { agentId: 'cfo', displayName: 'CFO — Funding', scope: 'fluxo de caixa' },
      custom: { agentId: 'custom', displayName: 'RH e Cultura', scope: 'clima organizacional' },
    };
    const roster = buildAgentRoster(profiles);
    expect(roster.map((r) => r.id)).toEqual(['cfo', 'custom', 'presidente']);
  });

  it('prefere o briefing gerado por IA sobre o corte cru do escopo, quando presente', () => {
    const profiles = {
      cfo: {
        agentId: 'cfo',
        displayName: 'CFO — Funding',
        scope: 'PODE opinar sobre: fluxo de caixa e exposição, funding e financiamento à produção',
        briefing: 'Cuida do caixa e do funding — te avisa antes de faltar dinheiro.',
      },
    };
    const roster = buildAgentRoster(profiles);
    expect(roster[0]!.briefing).toBe('Cuida do caixa e do funding — te avisa antes de faltar dinheiro.');
  });

  it('sem briefing gerado, cai no corte cru do escopo (compat)', () => {
    const profiles = {
      cfo: { agentId: 'cfo', displayName: 'CFO — Funding', scope: 'fluxo de caixa e exposição' },
    };
    const roster = buildAgentRoster(profiles);
    expect(roster[0]!.briefing).toBe('fluxo de caixa e exposição');
  });
});
