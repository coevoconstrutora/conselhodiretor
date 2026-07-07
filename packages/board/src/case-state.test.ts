import { describe, it, expect } from 'vitest';
import { FakeTextCompleter, FakeLlmProvider, type ILlmProvider } from '@conselho/providers';
import { CaseStateTracker, parseCaseState } from './case-state';

/** Provider fake com completeText roteirizado (B3). */
function llmWith(script: readonly string[]): { llm: ILlmProvider; completer: FakeTextCompleter } {
  const completer = new FakeTextCompleter(script);
  const base = new FakeLlmProvider('presidente');
  const llm: ILlmProvider = {
    complete: (req) => base.complete(req),
    completeText: (req) => completer.completeText(req),
  };
  return { llm, completer };
}

const STATE_JSON =
  '{"hypotheses":["hipotireoidismo subclínico"],"investigated":["TSH solicitado"],' +
  '"meetingPoints":["caixa apertado","obra atrasada"],"pending":{"cfo":["revisar projeção de caixa"]}}';

describe('CaseStateTracker (B3 — memória estruturada do caso)', () => {
  it('cadência: só atualiza após N finais novos; batch é consumido', async () => {
    const { llm, completer } = llmWith([STATE_JSON]);
    const tracker = new CaseStateTracker(llm, { everyNFinals: 3 });

    tracker.onFinalSegment('Fala 1.');
    tracker.onFinalSegment('Fala 2.');
    await tracker.maybeUpdate();
    expect(completer.requests).toHaveLength(0); // <N — não chama o LLM
    expect(tracker.current).toBeNull();

    tracker.onFinalSegment('Fala 3.');
    await tracker.maybeUpdate();
    expect(completer.requests).toHaveLength(1);
    expect(tracker.current?.hypotheses).toEqual(['hipotireoidismo subclínico']);

    // batch consumido: novo maybeUpdate sem novos finais é no-op
    await tracker.maybeUpdate();
    expect(completer.requests).toHaveLength(1);
  });

  it('update incremental: o estado ANTERIOR vai no prompt do próximo update', async () => {
    const { llm, completer } = llmWith([STATE_JSON, STATE_JSON]);
    const tracker = new CaseStateTracker(llm, { everyNFinals: 1 });
    tracker.onFinalSegment('Primeira fala.');
    await tracker.maybeUpdate();
    tracker.onFinalSegment('Segunda fala.');
    await tracker.maybeUpdate();

    expect(completer.requests[1]!.prompt).toContain('hipotireoidismo subclínico'); // estadoAnterior
    expect(completer.requests[1]!.prompt).toContain('Segunda fala.'); // novosTrechos
  });

  it('JSON inválido do modelo: mantém o estado anterior (nunca derruba o board)', async () => {
    const { llm } = llmWith([STATE_JSON, 'desculpe, não consegui gerar o JSON']);
    const tracker = new CaseStateTracker(llm, { everyNFinals: 1 });
    tracker.onFinalSegment('a');
    await tracker.maybeUpdate();
    const before = tracker.current;
    tracker.onFinalSegment('b');
    await tracker.maybeUpdate();
    expect(tracker.current).toBe(before); // preservado
  });

  it('nunca roda 2 updates em paralelo', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const llm: ILlmProvider = {
      complete: () => Promise.reject(new Error('não usado')),
      completeText: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return { text: STATE_JSON };
      },
    };
    const tracker = new CaseStateTracker(llm, { everyNFinals: 1 });
    tracker.onFinalSegment('a');
    tracker.onFinalSegment('b');
    await Promise.all([tracker.maybeUpdate(), tracker.maybeUpdate(), tracker.maybeUpdate()]);
    expect(maxInFlight).toBe(1);
  });

  it('provider SEM completeText: tracker desligado, zero erro (degradação graciosa)', async () => {
    const tracker = new CaseStateTracker(new FakeLlmProvider('presidente'), { everyNFinals: 1 });
    expect(tracker.enabled).toBe(false);
    tracker.onFinalSegment('a');
    await tracker.maybeUpdate();
    expect(tracker.current).toBeNull();
    expect(tracker.renderForPrompt()).toBe('');
  });

  it('renderForPrompt: bloco compacto pt-BR com as 4 seções', async () => {
    const { llm } = llmWith([STATE_JSON]);
    const tracker = new CaseStateTracker(llm, { everyNFinals: 1 });
    tracker.onFinalSegment('a');
    await tracker.maybeUpdate();
    const block = tracker.renderForPrompt();
    expect(block).toContain('ESTADO DO CASO');
    expect(block).toContain('hipotireoidismo subclínico');
    expect(block).toContain('TSH solicitado');
    expect(block).toContain('cfo: revisar projeção de caixa');
  });
});

describe('parseCaseState', () => {
  it('aceita cercas de código e filtra campos malformados', () => {
    const parsed = parseCaseState('```json\n{"hypotheses":["h1",42],"pending":{"cfo":["p1"],"x":["ig"]}}\n```');
    expect(parsed).toEqual({
      hypotheses: ['h1'],
      investigated: [],
      meetingPoints: [],
      pending: { cfo: ['p1'] },
    });
  });

  it('JSON inválido → null (sem exceção)', () => {
    expect(parseCaseState('não é json')).toBeNull();
  });
});
