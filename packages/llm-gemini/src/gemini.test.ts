import { describe, it, expect, vi } from 'vitest';
import {
  GeminiLlmProvider,
  GeminiLlmError,
  geminiConfigFromEnv,
  parseContribution,
  DEFAULT_MODEL,
} from './gemini';

function geminiResponse(
  text: string,
  opts: { model?: string; prompt?: number; total?: number } = {},
): Response {
  return new Response(
    JSON.stringify({
      modelVersion: opts.model ?? 'gemini-test-1',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
      usageMetadata: {
        promptTokenCount: opts.prompt ?? 10,
        totalTokenCount: opts.total ?? 25,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('geminiConfigFromEnv', () => {
  it('lança erro tipado (config) sem GEMINI_API_KEY', () => {
    expect(() => geminiConfigFromEnv('cfo', {} as NodeJS.ProcessEnv)).toThrowError(GeminiLlmError);
    try {
      geminiConfigFromEnv('cfo', {} as NodeJS.ProcessEnv);
    } catch (err) {
      expect((err as GeminiLlmError).kind).toBe('config');
    }
  });

  it('lê a chave e o modelo opcional do ambiente', () => {
    const config = geminiConfigFromEnv('cfo', {
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'gemini-pro-latest',
    } as NodeJS.ProcessEnv);
    expect(config.apiKey).toBe('k');
    expect(config.model).toBe('gemini-pro-latest');
  });
});

describe('GeminiLlmProvider.complete', () => {
  it('converte a resposta JSON do modelo em AgentContribution com usage', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        geminiResponse('{"type":"atencao","severity":"critical","text":"Reveja o caixa.","relevanceScore":0.9}'),
      );
    const onUsage = vi.fn();
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      agentId: 'cfo',
      onUsage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await provider.complete({
      system: 'você é o CFO',
      context: [{ id: 'kb1', agentId: 'cfo', text: 'regra' }],
      transcript: 'o caixa apertou',
    });
    expect(out.agentId).toBe('cfo');
    expect(out.type).toBe('atencao');
    expect(out.severity).toBe('critical');
    expect(out.text).toBe('Reveja o caixa.');
    expect(out.kbSources).toEqual(['kb1']);
    expect(out.modelVersion).toBe('gemini-test-1');
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 15 });
    // modelo default no caminho da URL
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain(`/models/${DEFAULT_MODEL}:generateContent`);
    // board (não-longForm) desliga o thinking
    const body = JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('respeita {"skip":true} do modelo (anti-repetição B1)', async () => {
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      agentId: 'legal',
      fetchImpl: vi.fn().mockResolvedValue(geminiResponse('{"skip":true}')) as unknown as typeof fetch,
    });
    const out = await provider.complete({
      system: 's',
      context: [],
      transcript: 't',
      allowSkip: true,
    });
    expect(out.skip).toBe(true);
    expect(out.text).toBe('');
  });

  it('faz FALLBACK de modelo em 503 e registra o modelo que respondeu', async () => {
    const overloaded = new Response(
      JSON.stringify({ error: { message: 'high demand', status: 'UNAVAILABLE' } }),
      { status: 503 },
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(overloaded)
      .mockResolvedValueOnce(
        geminiResponse('{"type":"sugestao","severity":"normal","text":"ok"}', {
          model: 'gemini-3-flash-preview',
        }),
      );
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      agentId: 'vendas',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await provider.complete({ system: 's', context: [], transcript: 't' });
    expect(out.text).toBe('ok');
    expect(out.modelVersion).toBe('gemini-3-flash-preview');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('gemini-3-flash-preview');
  });

  it('erro que NÃO é 503/404 lança direto (sem fallback)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }),
    );
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      agentId: 'cfo',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.complete({ system: 's', context: [], transcript: 't' })).rejects.toThrowError(
      GeminiLlmError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('timeout vira GeminiLlmError(network), nunca exceção nativa', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      agentId: 'cfo',
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    try {
      await provider.complete({ system: 's', context: [], transcript: 't' });
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(GeminiLlmError);
      expect((err as GeminiLlmError).kind).toBe('network');
    }
  });
});

describe('GeminiLlmProvider.completeText', () => {
  it('devolve texto livre com modelVersion', async () => {
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      agentId: 'presidente',
      fetchImpl: vi.fn().mockResolvedValue(geminiResponse('resumo do caso')) as unknown as typeof fetch,
    });
    const out = await provider.completeText({ system: 's', prompt: 'p' });
    expect(out.text).toBe('resumo do caso');
    expect(out.modelVersion).toBe('gemini-test-1');
  });
});

describe('parseContribution', () => {
  it('aceita cercas de código e valida enums com fallback', () => {
    const parsed = parseContribution('```json\n{"type":"inválido","severity":"x","text":"oi"}\n```');
    expect(parsed.type).toBe('sugestao');
    expect(parsed.severity).toBe('normal');
    expect(parsed.text).toBe('oi');
  });

  it('JSON quebrado lança erro tipado (parse)', () => {
    expect(() => parseContribution('não é json')).toThrowError(GeminiLlmError);
  });
});
