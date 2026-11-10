import { describe, it, expect } from 'vitest';
import type { ILlmProvider } from '@conselho/providers';
import { assessTranscriptSubstance, insufficientCounselorReport } from './substance';
import { extractMeetingOutcome } from './decisions';
import { generateCounselorReport } from './reports';

const REAL_MEETING = [
  'Locutor 1: Vamos revisar o fluxo de caixa do empreendimento Aurora, o VGV está em doze milhões e a margem caiu.',
  'Locutor 2: O distrato de duas unidades preocupa, precisamos renegociar com a construtora antes do fim do mês.',
  'Locutor 1: Combinado, a Marina assume a revisão do orçamento da obra e entrega até sexta-feira.',
];

/** LLM que falha o teste se for chamado — a trava deve evitar a chamada. */
function forbiddenLlm(): ILlmProvider {
  const boom = () => {
    throw new Error('LLM não deveria ser chamado');
  };
  return { complete: boom, completeText: boom } as unknown as ILlmProvider;
}

describe('assessTranscriptSubstance', () => {
  it('"Bom dia. Ok." não tem conteúdo', () => {
    const s = assessTranscriptSubstance(['Locutor 1: Bom dia. Ok.']);
    expect(s.sufficient).toBe(false);
    expect(s.substantiveWords).toBe(0);
  });

  it('teste de áudio não tem conteúdo', () => {
    expect(
      assessTranscriptSubstance(['Alô, testando, um dois três, está gravando?', 'Tudo bem, pode ouvir o som aqui, ok?']).sufficient,
    ).toBe(false);
  });

  it('transcrição vazia não tem conteúdo', () => {
    expect(assessTranscriptSubstance([]).sufficient).toBe(false);
  });

  it('reunião de verdade tem conteúdo', () => {
    expect(assessTranscriptSubstance(REAL_MEETING).sufficient).toBe(true);
  });
});

describe('trava de conteúdo mínimo', () => {
  it('relatório do conselheiro vira texto fixo, sem chamar a IA', async () => {
    const text = await generateCounselorReport(forbiddenLlm(), 'qualquer', 'cfo', ['Locutor 1: Bom dia. Ok.']);
    expect(text).toBe(insufficientCounselorReport({ sufficient: false, substantiveWords: 0 }));
    expect(text).toContain('Nenhuma. Não faço recomendações');
  });

  it('extração de decisões/ações devolve vazio, sem chamar a IA', async () => {
    const outcome = await extractMeetingOutcome(
      forbiddenLlm(),
      '## Síntese\nRecomendo obter pauta e registrar responsáveis.',
      undefined,
      undefined,
      ['Locutor 1: Bom dia. Ok.'],
    );
    expect(outcome).toEqual({ decisions: [], actionItems: [] });
  });
});
