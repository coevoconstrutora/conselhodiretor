import { describe, it, expect, vi } from 'vitest';
import {
  AnthropicLlmProvider,
  AnthropicLlmError,
  anthropicConfigFromEnv,
  parseContribution,
} from './anthropic';

function fakeFetch(body: object, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const okResponse = {
  model: 'claude-haiku-4-5-20251001',
  content: [
    {
      type: 'text',
      text: '{"type":"atencao","severity":"critical","text":"Vale checar PA e FC antes de iniciar GLP-1 com histórico de palpitação.","relevanceScore":0.92}',
    },
  ],
};

describe('AnthropicLlmProvider (Claude Haiku — Stories 3.1/3.4)', () => {
  it('monta a requisição da Messages API e mapeia a AgentContribution', async () => {
    const doFetch = fakeFetch(okResponse);
    const provider = new AnthropicLlmProvider({
      apiKey: 'sk-ant-test',
      agentId: 'legal',
      fetchImpl: doFetch,
    });

    const contribution = await provider.complete({
      system: 'Você é o Dr. Paulo.',
      context: [
        { id: 'paulo-1', agentId: 'legal', text: 'Avaliar PA/FC antes de ajustar dose.' },
      ],
      transcript: 'Vou iniciar semaglutida; paciente refere palpitação.',
    });

    expect(contribution).toMatchObject({
      agentId: 'legal',
      type: 'atencao',
      severity: 'critical',
      relevanceScore: 0.92,
      kbSources: ['paulo-1'],
      modelVersion: 'claude-haiku-4-5-20251001',
    });
    expect(contribution.text).toContain('PA e FC');

    const [url, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.system).toContain('Dr. Paulo');
    expect(body.system).toContain('JSON');
    expect(body.messages[0].content).toContain('semaglutida');
    expect(body.messages[0].content).toContain('paulo-1'); // KB no contexto
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
  });

  it('B1 — priors entram no prompt e allowSkip instrui o {"skip":true}', async () => {
    const doFetch = fakeFetch(okResponse);
    const provider = new AnthropicLlmProvider({ apiKey: 'sk-ant-test', agentId: 'legal', fetchImpl: doFetch });

    await provider.complete({
      system: 'Você é o Dr. Paulo.',
      context: [],
      transcript: 'Paciente segue com palpitação.',
      priorContributions: ['[Dr. Paulo Tavares (Cardiologia)] Vale checar PA e FC.'],
      allowSkip: true,
    });

    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toContain('Contribuições JÁ FEITAS pelo conselho');
    expect(body.messages[0].content).toContain('Vale checar PA e FC.');
    expect(body.system).toContain('{"skip":true}');
  });

  it('B1 — sem priors/allowSkip o prompt fica como antes (aditivo)', async () => {
    const doFetch = fakeFetch(okResponse);
    const provider = new AnthropicLlmProvider({ apiKey: 'sk-ant-test', agentId: 'legal', fetchImpl: doFetch });
    await provider.complete({ system: 's', context: [], transcript: 't' });
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).not.toContain('Contribuições JÁ FEITAS');
    expect(body.system).not.toContain('{"skip":true}');
  });

  it('B1 — resposta {"skip":true} vira contribuição com skip (sem texto exigido)', async () => {
    const doFetch = fakeFetch({
      model: 'claude-haiku-4-5-20251001',
      content: [{ type: 'text', text: '{"skip":true}' }],
    });
    const provider = new AnthropicLlmProvider({ apiKey: 'sk-ant-test', agentId: 'mercado', fetchImpl: doFetch });
    const contribution = await provider.complete({
      system: 's',
      context: [],
      transcript: 't',
      allowSkip: true,
    });
    expect(contribution.skip).toBe(true);
    expect(contribution.agentId).toBe('mercado');
  });

  it('erro da API vira AnthropicLlmError tipado', async () => {
    const provider = new AnthropicLlmProvider({
      apiKey: 'k',
      agentId: 'legal',
      fetchImpl: fakeFetch({ error: { message: 'overloaded' } }, 529),
    });
    await expect(
      provider.complete({ system: 's', context: [], transcript: 't' }),
    ).rejects.toThrow(/overloaded/);
  });

  it('credencial ausente/vazia gera erro de config', () => {
    expect(() => anthropicConfigFromEnv('legal', {} as NodeJS.ProcessEnv)).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => new AnthropicLlmProvider({ apiKey: '', agentId: 'legal' })).toThrow(
      AnthropicLlmError,
    );
  });
});

describe('parseContribution — parse tolerante do JSON do modelo', () => {
  it('aceita cercas de código e normaliza type/severity inválidos', () => {
    const parsed = parseContribution('```json\n{"type":"x","severity":"y","text":"ok"}\n```');
    expect(parsed).toMatchObject({ type: 'sugestao', severity: 'normal', text: 'ok' });
  });

  it('B1 — parse reconhece {"skip":true} antes de exigir texto', () => {
    expect(parseContribution('{"skip":true}')).toMatchObject({ skip: true });
    expect(parseContribution('```json\n{"skip":true}\n```')).toMatchObject({ skip: true });
  });

  it('rejeita JSON inválido e contribuição sem texto', () => {
    expect(() => parseContribution('não é json')).toThrow(/JSON inválido/);
    expect(() => parseContribution('{"type":"sugestao"}')).toThrow(/sem texto/);
  });
});
