import { describe, it, expect, vi } from 'vitest';
import {
  OpenAiLlmProvider,
  OpenAiLlmError,
  openAiConfigFromEnv,
  parseContribution,
} from './openai';

function fakeFetch(body: object, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const okResponse = {
  model: 'gpt-4o-mini-2024-07-18',
  choices: [
    {
      message: {
        content:
          '{"type":"atencao","severity":"critical","text":"Vale renegociar a cláusula de multa antes de assinar.","relevanceScore":0.92}',
      },
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 40 },
};

describe('OpenAiLlmProvider (Chat Completions — adapter NFR8)', () => {
  it('monta a requisição e mapeia a AgentContribution', async () => {
    const doFetch = fakeFetch(okResponse);
    const provider = new OpenAiLlmProvider({
      apiKey: 'sk-test',
      agentId: 'legal',
      fetchImpl: doFetch,
    });

    const contribution = await provider.complete({
      system: 'Você é o conselheiro Legal.',
      context: [{ id: 'legal-1', agentId: 'legal', text: 'Revisar cláusula de multa.' }],
      transcript: 'Vamos fechar o contrato com a construtora.',
    });

    expect(contribution).toMatchObject({
      agentId: 'legal',
      type: 'atencao',
      severity: 'critical',
      relevanceScore: 0.92,
      kbSources: ['legal-1'],
      modelVersion: 'gpt-4o-mini-2024-07-18',
    });
    expect(contribution.text).toContain('multa');

    const [url, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('Legal');
    expect(body.messages[1].content).toContain('construtora');
    expect(body.messages[1].content).toContain('legal-1'); // KB no contexto
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('B1 — priors entram no prompt e allowSkip instrui o {"skip":true}', async () => {
    const doFetch = fakeFetch(okResponse);
    const provider = new OpenAiLlmProvider({ apiKey: 'sk-test', agentId: 'legal', fetchImpl: doFetch });

    await provider.complete({
      system: 'Você é o conselheiro Legal.',
      context: [],
      transcript: 'Seguimos com a negociação.',
      priorContributions: ['[Legal] Vale renegociar a multa.'],
      allowSkip: true,
    });

    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[1].content).toContain('Contribuições JÁ FEITAS pelo conselho');
    expect(body.messages[1].content).toContain('Vale renegociar a multa.');
    expect(body.messages[0].content).toContain('{"skip":true}');
  });

  it('B1 — resposta {"skip":true} vira contribuição com skip (sem texto exigido)', async () => {
    const doFetch = fakeFetch({
      model: 'gpt-4o-mini-2024-07-18',
      choices: [{ message: { content: '{"skip":true}' } }],
    });
    const provider = new OpenAiLlmProvider({ apiKey: 'sk-test', agentId: 'mercado', fetchImpl: doFetch });
    const contribution = await provider.complete({
      system: 's',
      context: [],
      transcript: 't',
      allowSkip: true,
    });
    expect(contribution.skip).toBe(true);
    expect(contribution.agentId).toBe('mercado');
  });

  it('completeText não força response_format json_object', async () => {
    const doFetch = fakeFetch({
      model: 'gpt-4o-mini-2024-07-18',
      choices: [{ message: { content: 'texto livre' } }],
    });
    const provider = new OpenAiLlmProvider({ apiKey: 'sk-test', agentId: 'legal', fetchImpl: doFetch });
    const result = await provider.completeText({ system: 's', prompt: 'p' });
    expect(result.text).toBe('texto livre');
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('erro da API vira OpenAiLlmError tipado', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: 'k',
      agentId: 'legal',
      fetchImpl: fakeFetch({ error: { message: 'rate limited' } }, 429),
    });
    await expect(
      provider.complete({ system: 's', context: [], transcript: 't' }),
    ).rejects.toThrow(/rate limited/);
  });

  it('credencial ausente/vazia gera erro de config', () => {
    expect(() => openAiConfigFromEnv('legal', {} as NodeJS.ProcessEnv)).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() => new OpenAiLlmProvider({ apiKey: '', agentId: 'legal' })).toThrow(
      OpenAiLlmError,
    );
  });
});

describe('parseContribution — parse tolerante do JSON do modelo', () => {
  it('aceita cercas de código e normaliza type/severity inválidos', () => {
    const parsed = parseContribution('```json\n{"type":"x","severity":"y","text":"ok"}\n```');
    expect(parsed).toMatchObject({ type: 'sugestao', severity: 'normal', text: 'ok' });
  });

  it('rejeita JSON inválido e contribuição sem texto', () => {
    expect(() => parseContribution('não é json')).toThrow(/JSON inválido/);
    expect(() => parseContribution('{"type":"sugestao"}')).toThrow(/sem texto/);
  });
});
