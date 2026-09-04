import { describe, it, expect } from 'vitest';
import { formatParticipantSignalsBlock, type ParticipantSignal } from './participant-signals';

describe('formatParticipantSignalsBlock — Etapa "Participantes", Seção 25', () => {
  it('vazio ⇒ string vazia (sem sinais, sem bloco no prompt)', () => {
    expect(formatParticipantSignalsBlock([])).toBe('');
  });

  it('formata intervenções e fatia de fala, sem rótulo emocional', () => {
    const signals: ParticipantSignal[] = [
      { name: 'Marina Costa', speakingTurns: 6, speechShare: 0.29, speakingMs: 0, interruptionCount: 0 },
      { name: 'Jonathan', speakingTurns: 2, speechShare: null, speakingMs: 0, interruptionCount: 0 },
    ];
    const block = formatParticipantSignalsBlock(signals);
    expect(block).toContain('Marina Costa: 6 intervenções (29% da fala identificada)');
    expect(block).toContain('Jonathan: 2 intervenções');
    expect(block).toContain('NUNCA rotule estado');
    // nunca linguagem de estado emocional/psicológico nos dados em si
    expect(block).not.toMatch(/ansios|nervos|irritad/i);
  });

  it('inclui tempo real de fala e trocas abruptas de turno quando presentes', () => {
    const signals: ParticipantSignal[] = [
      { name: 'Marina Costa', speakingTurns: 6, speechShare: 0.29, speakingMs: 125_000, interruptionCount: 2 },
    ];
    const block = formatParticipantSignalsBlock(signals);
    expect(block).toContain('2min05s de fala');
    expect(block).toContain('2 troca(s) abrupta(s) de turno');
    expect(block).toContain('aproximação por');
  });
});
