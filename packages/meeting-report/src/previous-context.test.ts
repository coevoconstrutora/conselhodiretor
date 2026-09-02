import { describe, it, expect } from 'vitest';
import { buildPreviousMeetingContextBlock, type PreviousMeetingContext } from './previous-context';

function ctx(overrides: Partial<PreviousMeetingContext> = {}): PreviousMeetingContext {
  return {
    meetingId: 'm1',
    title: 'Comitê Geral',
    closedAt: new Date('2026-08-28T12:00:00Z'),
    summary: null,
    decisions: [],
    pendingDecisions: [],
    actionItems: [],
    ...overrides,
  };
}

describe('buildPreviousMeetingContextBlock — Etapa "Histórico de reuniões", Seção 15', () => {
  it('inclui título, resumo, decisões pendentes e ações em aberto', () => {
    const block = buildPreviousMeetingContextBlock(
      ctx({
        summary: 'Discutimos o orçamento da obra.',
        pendingDecisions: [
          {
            id: 'd1',
            topic: 'Fornecedor de fachada',
            decision: 'Selecionar B',
            status: 'pendente',
            responsible: '',
            deadline: null,
            evidence: '',
            createdAt: new Date(),
          },
        ],
        actionItems: [
          { id: 'a1', decisionId: null, action: 'Assinar contrato', responsible: '', deadline: null, createdAt: new Date() },
        ],
      }),
    );
    expect(block).toContain('Comitê Geral');
    expect(block).toContain('Discutimos o orçamento da obra.');
    expect(block).toContain('Fornecedor de fachada (Selecionar B)');
    expect(block).toContain('Assinar contrato');
    expect(block).toContain('escolhido explicitamente pelo dono');
  });

  it('sem resumo/decisões/ações: ainda identifica a reunião, sem seções vazias soltas', () => {
    const block = buildPreviousMeetingContextBlock(ctx());
    expect(block).toContain('Comitê Geral');
    expect(block).not.toContain('Decisões PENDENTES');
    expect(block).not.toContain('Ações em aberto');
  });
});
