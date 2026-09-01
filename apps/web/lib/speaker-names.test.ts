import { describe, it, expect } from 'vitest';
import { createSpeakerNameTracker } from './speaker-names';

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
});
