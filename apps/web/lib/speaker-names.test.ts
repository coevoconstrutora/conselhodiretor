import { describe, it, expect } from 'vitest';
import { createSpeakerNameTracker, unresolvedSpeakerNum } from './speaker-names';

describe('createSpeakerNameTracker — nomeia quem fala por autoapresentação', () => {
  it('troca "Locutor N" pelo nome quando a fala se autoapresenta ("sou o/a Nome")', () => {
    const tracker = createSpeakerNameTracker();
    const out = tracker.apply('Locutor 1: sou a Marina, da área Jurídica.');
    expect(out).toBe('Marina: sou a Marina, da área Jurídica.');
  });

  it('reconhece "aqui é o/a Nome" e "meu nome é Nome"', () => {
    const tracker = createSpeakerNameTracker();
    expect(tracker.apply('Locutor 1: aqui é o Carlos, bom dia a todos.')).toBe(
      'Carlos: aqui é o Carlos, bom dia a todos.',
    );
    const tracker2 = createSpeakerNameTracker();
    expect(tracker2.apply('Locutor 2: meu nome é Ana Paula.')).toBe('Ana Paula: meu nome é Ana Paula.');
  });

  it('reaplica o nome já conhecido na PRÓXIMA vez que o locutor volta a falar', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: sou a Marina, da área Jurídica.');
    // outro locutor fala no meio, depois Locutor 1 volta — novo prefixo "Locutor 1:"
    tracker.apply('Locutor 2: sou o Carlos, da área Financeira.');
    const out = tracker.apply('Locutor 1: voltando ao ponto anterior sobre o contrato.');
    expect(out).toBe('Marina: voltando ao ponto anterior sobre o contrato.');
  });

  it('sem autoapresentação, mantém "Locutor N" (não inventa nome)', () => {
    const tracker = createSpeakerNameTracker();
    const out = tracker.apply('Locutor 1: vamos revisar o orçamento da obra.');
    expect(out).toBe('Locutor 1: vamos revisar o orçamento da obra.');
  });

  it('texto sem prefixo de troca de locutor (continuação) passa direto', () => {
    const tracker = createSpeakerNameTracker();
    const out = tracker.apply('e também precisamos revisar o cronograma.');
    expect(out).toBe('e também precisamos revisar o cronograma.');
  });

  it('Tier 2 — override() nomeia manualmente um locutor sem autoapresentação', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: vamos revisar o orçamento da obra.'); // ninguém se apresentou
    tracker.override('1', 'joão');
    const out = tracker.apply('Locutor 1: seguimos com o próximo ponto.');
    expect(out).toBe('João: seguimos com o próximo ponto.');
  });

  it('Tier 2 — override() corrige um nome que a autoapresentação errou', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: sou a Marina, da área Jurídica.');
    tracker.override('1', 'Mariana');
    const out = tracker.apply('Locutor 1: só uma correção no meu nome.');
    expect(out).toBe('Mariana: só uma correção no meu nome.');
  });

  it('Tier 2 — override() com nome vazio/em branco não sobrescreve nada', () => {
    const tracker = createSpeakerNameTracker();
    tracker.override('1', '   ');
    const out = tracker.apply('Locutor 1: vamos começar.');
    expect(out).toBe('Locutor 1: vamos começar.');
  });

  it('listKnown() captura nome + área da autoapresentação', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: sou a Marina, da área Jurídica.');
    tracker.apply('Locutor 2: sou o Carlos, do departamento Financeiro.');
    expect(tracker.listKnown()).toEqual([
      { speakerNum: '1', name: 'Marina', area: 'Jurídica' },
      { speakerNum: '2', name: 'Carlos', area: 'Financeiro' },
    ]);
  });

  it('listKnown() não inventa área quando a fala não menciona uma', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: sou a Marina, bom dia a todos.');
    expect(tracker.listKnown()).toEqual([{ speakerNum: '1', name: 'Marina', area: null }]);
  });

  it('Tier 2 — override() aceita área e ela aparece em listKnown()', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: vamos revisar o orçamento da obra.'); // ninguém se apresentou
    tracker.override('1', 'João', 'Engenharia');
    expect(tracker.listKnown()).toEqual([{ speakerNum: '1', name: 'João', area: 'Engenharia' }]);
  });

  it('Tier 2 — override() sem área preserva a área já conhecida', () => {
    const tracker = createSpeakerNameTracker();
    tracker.apply('Locutor 1: sou a Marina, da área Jurídica.');
    tracker.override('1', 'Mariana'); // corrige só o nome, sem passar área
    expect(tracker.listKnown()).toEqual([{ speakerNum: '1', name: 'Mariana', area: 'Jurídica' }]);
  });
});

describe('unresolvedSpeakerNum — Etapa "Reconhecimento de voz ao vivo"', () => {
  it('extrai o número quando o rótulo ainda é "Locutor N" cru', () => {
    expect(unresolvedSpeakerNum('Locutor 3: vamos revisar o orçamento.')).toBe('3');
  });

  it('null quando o locutor já tem nome resolvido', () => {
    expect(unresolvedSpeakerNum('Marina: vamos revisar o orçamento.')).toBeNull();
  });

  it('null em string vazia ou sem o prefixo esperado', () => {
    expect(unresolvedSpeakerNum('')).toBeNull();
    expect(unresolvedSpeakerNum('algo qualquer sem locutor')).toBeNull();
  });
});
