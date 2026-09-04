import { describe, it, expect } from 'vitest';
import { FakeLlmProvider } from '@conselho/providers';
import type { ILlmProvider, TextCompletionRequest } from '@conselho/providers';
import { generateSpeechTone } from './speech-tone';

/** Mock mínimo de ILlmProvider com completeText controlável — os fakes
 * compartilhados (FakeLlmProvider/FakeTextCompleter) não cobrem as duas
 * pontas ao mesmo tempo (complete + completeText opcional). */
function fakeWithCompleteText(response: string): ILlmProvider {
  const requests: TextCompletionRequest[] = [];
  return {
    async complete() {
      throw new Error('não deveria chamar complete() — só completeText()');
    },
    async completeText(req: TextCompletionRequest) {
      requests.push(req);
      return { text: response, modelVersion: 'fake-v1' };
    },
    // exposto pro teste inspecionar a última chamada
    __requests: requests,
  } as ILlmProvider & { __requests: TextCompletionRequest[] };
}

describe('generateSpeechTone — Etapa "Análise de fala dos presentes" (exceção opt-in à política emocional)', () => {
  it('sem falas ⇒ null, nunca chama o LLM', async () => {
    const llm = fakeWithCompleteText('texto');
    const result = await generateSpeechTone(llm, 'Marina Costa', []);
    expect(result).toBeNull();
  });

  it('provider sem completeText ⇒ degrada para null (nunca lança)', async () => {
    const llm = new FakeLlmProvider('legal', 'atencao'); // não implementa completeText
    const result = await generateSpeechTone(llm, 'Marina Costa', ['Precisamos fechar isso até sexta.']);
    expect(result).toBeNull();
  });

  it('monta o prompt com o nome e as falas, e devolve o texto do modelo', async () => {
    const llm = fakeWithCompleteText(
      'Fala de forma direta e afirmativa, ancorada em prazos concretos. ' +
        '_Leitura aproximada de estilo de linguagem gerada por IA — não é uma avaliação psicológica._',
    );
    const result = await generateSpeechTone(llm, 'Marina Costa', [
      'Precisamos fechar isso até sexta.',
      'Já validei os números com o financeiro.',
    ]);
    expect(result).toContain('Leitura aproximada de estilo de linguagem');
    const req = (llm as ILlmProvider & { __requests: TextCompletionRequest[] }).__requests[0]!;
    expect(req.prompt).toContain('Marina Costa');
    expect(req.prompt).toContain('Precisamos fechar isso até sexta.');
    // a instrução anti-inferência-emocional tem que estar no system prompt, sempre
    expect(req.system).toContain('NUNCA nomeie emoção');
  });

  it('resposta vazia do modelo ⇒ null', async () => {
    const llm = fakeWithCompleteText('   ');
    const result = await generateSpeechTone(llm, 'Marina Costa', ['algo']);
    expect(result).toBeNull();
  });
});
