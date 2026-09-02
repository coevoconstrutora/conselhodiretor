import { describe, it, expect } from 'vitest';
import { formatParticipantSignalsBlock, type ParticipantSignal } from './participant-signals';

describe('formatParticipantSignalsBlock — Etapa "Participantes", Seção 25', () => {
  it('vazio ⇒ string vazia (sem sinais, sem bloco no prompt)', () => {
    expect(formatParticipantSignalsBlock([])).toBe('');
  });

  it('formata intervenções e fatia de fala, sem rótulo emocional', () => {
    const signals: ParticipantSignal[] = [
      { name: 'Marina Costa', speakingTurns: 6, speechShare: 0.29 },
      { name: 'Jonathan', speakingTurns: 2, speechShare: null },
    ];
    const block = formatParticipantSignalsBlock(signals);
    expect(block).toContain('Marina Costa: 6 intervenções (29% da fala identificada)');
    expect(block).toContain('Jonathan: 2 intervenções');
    expect(block).toContain('NUNCA rotule estado');
    // nunca linguagem de estado emocional/psicológico nos dados em si
    expect(block).not.toMatch(/ansios|nervos|irritad/i);
  });
});
