import { describe, it, expect } from 'vitest';
import { parseExtractedOutcome, extractMeetingOutcome } from './decisions';
import type { ILlmProvider, TextCompletionRequest } from '@conselho/providers';

describe('parseExtractedOutcome — parse defensivo (Etapa "Histórico de reuniões")', () => {
  it('extrai decisões e ações de um JSON válido', () => {
    const raw = JSON.stringify({
      decisions: [
        {
          topic: 'Fornecedor de fachada',
          decision: 'Selecionar o fornecedor B',
          status: 'decidido',
          responsible: 'Carlos',
          deadline: '2026-09-10',
          evidence: 'Proposta final aprovada',
        },
      ],
      actionItems: [
        { action: 'Assinar contrato', responsible: 'Jurídico', deadline: '2026-09-15', relatedDecisionTopic: 'Fornecedor de fachada' },
      ],
    });
    const result = parseExtractedOutcome(raw);
    expect(result?.decisions).toHaveLength(1);
    expect(result?.decisions[0]!.status).toBe('decidido');
    expect(result?.actionItems).toHaveLength(1);
    expect(result?.actionItems[0]!.relatedDecisionTopic).toBe('Fornecedor de fachada');
  });

  it('aceita cercas de código markdown ao redor do JSON', () => {
    const raw = '```json\n{"decisions":[],"actionItems":[]}\n```';
    expect(parseExtractedOutcome(raw)).toEqual({ decisions: [], actionItems: [] });
  });

  it('descarta decisão sem topic/decision e ação sem action (campos essenciais ausentes)', () => {
    const raw = JSON.stringify({
      decisions: [{ topic: '', decision: 'x' }, { topic: 'y' }],
      actionItems: [{ action: '' }, { responsible: 'sem action' }],
    });
    const result = parseExtractedOutcome(raw);
    expect(result?.decisions).toHaveLength(0);
    expect(result?.actionItems).toHaveLength(0);
  });

  it('status desconhecido cai em "pendente" (nunca quebra, nunca inventa DECIDIDO)', () => {
    const raw = JSON.stringify({
      decisions: [{ topic: 'x', decision: 'y', status: 'algo-nao-suportado' }],
      actionItems: [],
    });
    expect(parseExtractedOutcome(raw)?.decisions[0]!.status).toBe('pendente');
  });

  it('deadline em formato inválido vira null (nunca quebra o parse)', () => {
    const raw = JSON.stringify({
      decisions: [{ topic: 'x', decision: 'y', deadline: 'semana que vem' }],
      actionItems: [],
    });
    expect(parseExtractedOutcome(raw)?.decisions[0]!.deadline).toBeNull();
  });

  it('JSON malformado devolve null — nunca lança', () => {
    expect(parseExtractedOutcome('isto não é JSON')).toBeNull();
  });

  it('sem decisões nem ações: listas vazias, não null', () => {
    expect(parseExtractedOutcome('{"decisions":[],"actionItems":[]}')).toEqual({
      decisions: [],
      actionItems: [],
    });
  });
});

describe('extractMeetingOutcome — degradação graciosa (nunca derruba a geração dos relatórios)', () => {
  it('provider sem completeText: devolve null sem lançar', async () => {
    const llm: ILlmProvider = { complete: async () => { throw new Error('não deveria chamar complete()'); } };
    expect(await extractMeetingOutcome(llm, 'síntese qualquer')).toBeNull();
  });

  it('completeText lança: devolve null sem lançar', async () => {
    const llm: ILlmProvider = {
      complete: async () => { throw new Error('não deveria chamar complete()'); },
      completeText: async () => { throw new Error('falha de rede'); },
    };
    expect(await extractMeetingOutcome(llm, 'síntese qualquer')).toBeNull();
  });

  it('caminho feliz: repassa a síntese no prompt e o override de modelo/raciocínio', async () => {
    let received: TextCompletionRequest | null = null;
    const llm: ILlmProvider = {
      complete: async () => { throw new Error('não deveria chamar complete()'); },
      completeText: async (req) => {
        received = req;
        return { text: '{"decisions":[],"actionItems":[]}' };
      },
    };
    const result = await extractMeetingOutcome(llm, 'Decidimos selecionar o fornecedor B.', 'gpt-5.6-sol', 'high');
    expect(result).toEqual({ decisions: [], actionItems: [] });
    expect(received!.prompt).toContain('Decidimos selecionar o fornecedor B.');
    expect(received!.model).toBe('gpt-5.6-sol');
    expect(received!.reasoningEffort).toBe('high');
  });
});
