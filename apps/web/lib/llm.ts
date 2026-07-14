import 'server-only';
import { AnthropicLlmProvider } from '@conselho/llm-anthropic';
import { GeminiLlmProvider } from '@conselho/llm-gemini';
import { FakeLlmProvider, type ILlmProvider } from '@conselho/providers';

/**
 * Factory ÚNICA do LLM (NFR8): todo consumidor (board, relatórios) cria o
 * provider por aqui — trocar de fornecedor é trocar env, nunca código.
 *
 * Seleção:
 * - `LLM_PROVIDER=gemini|anthropic|fake` força um provedor;
 * - sem LLM_PROVIDER: GEMINI_API_KEY > ANTHROPIC_API_KEY > fake (dev).
 * Modelo do Gemini: `GEMINI_MODEL` (default gemini-flash-latest, com
 * fallback automático de modelo em 503/404 dentro do adapter).
 */

export interface LlmOptions {
  readonly longForm?: boolean;
  readonly maxTokens?: number;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export function createLlm(opts: LlmOptions = {}): { llm: ILlmProvider; label: string } {
  const forced = (process.env.LLM_PROVIDER ?? '').toLowerCase();

  const wantGemini = forced === 'gemini' || (!forced && !!process.env.GEMINI_API_KEY);
  if (wantGemini) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('LLM_PROVIDER=gemini exige GEMINI_API_KEY no ambiente.');
    const model = process.env.GEMINI_MODEL || undefined;
    return {
      llm: new GeminiLlmProvider({
        apiKey,
        agentId: 'presidente', // fallback — o Reasoner define o agente por contribuição
        ...(model ? { model } : {}),
        ...(opts.longForm ? { longForm: true } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
      }),
      label: `${model ?? 'gemini-flash-latest'} (Gemini)`,
    };
  }

  const wantAnthropic = forced === 'anthropic' || (!forced && !!process.env.ANTHROPIC_API_KEY);
  if (wantAnthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('LLM_PROVIDER=anthropic exige ANTHROPIC_API_KEY no ambiente.');
    return {
      llm: new AnthropicLlmProvider({
        apiKey,
        agentId: 'presidente',
        ...(opts.longForm ? { longForm: true } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
      }),
      label: 'claude-haiku-4-5 (Anthropic)',
    };
  }

  return { llm: new FakeLlmProvider('legal', 'atencao'), label: 'fake (sem chave de LLM)' };
}
