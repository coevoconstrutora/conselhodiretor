import 'server-only';
import { AnthropicLlmProvider } from '@conselho/llm-anthropic';
import { GeminiLlmProvider } from '@conselho/llm-gemini';
import { OpenAiLlmProvider } from '@conselho/llm-openai';
import { FakeLlmProvider, type ILlmProvider } from '@conselho/providers';

/**
 * Factory ÚNICA do LLM (NFR8): todo consumidor (board, relatórios) cria o
 * provider por aqui — trocar de fornecedor é trocar env, nunca código.
 *
 * Seleção:
 * - `LLM_PROVIDER=openai|gemini|anthropic|fake` força um provedor;
 * - sem LLM_PROVIDER: OPENAI_API_KEY > GEMINI_API_KEY > ANTHROPIC_API_KEY > fake (dev).
 * Modelo do Gemini: `GEMINI_MODEL` (default gemini-flash-latest, com
 * fallback automático de modelo em 503/404 dentro do adapter). Modelo da
 * OpenAI: `OPENAI_MODEL` (default gpt-5-mini). Modelo da Anthropic:
 * `ANTHROPIC_MODEL` (default claude-sonnet-5). Piso do produto: nenhum
 * provedor usa modelo abaixo da geração 5.x (Gemini escapa dessa régua —
 * o Google não versiona por "5.x").
 */

export interface LlmOptions {
  readonly longForm?: boolean;
  readonly maxTokens?: number;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export function createLlm(opts: LlmOptions = {}): { llm: ILlmProvider; label: string } {
  const forced = (process.env.LLM_PROVIDER ?? '').toLowerCase();

  const wantOpenAi = forced === 'openai' || (!forced && !!process.env.OPENAI_API_KEY);
  if (wantOpenAi) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('LLM_PROVIDER=openai exige OPENAI_API_KEY no ambiente.');
    const model = process.env.OPENAI_MODEL || undefined;
    return {
      llm: new OpenAiLlmProvider({
        apiKey,
        agentId: 'presidente', // fallback — o Reasoner define o agente por contribuição
        ...(model ? { model } : {}),
        ...(opts.longForm ? { longForm: true } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
      }),
      label: `${model ?? 'gpt-5-mini'} (OpenAI)`,
    };
  }

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
    const anthropicModel = process.env.ANTHROPIC_MODEL || undefined;
    return {
      llm: new AnthropicLlmProvider({
        apiKey,
        agentId: 'presidente',
        ...(anthropicModel ? { model: anthropicModel } : {}),
        ...(opts.longForm ? { longForm: true } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
      }),
      label: `${anthropicModel ?? 'claude-sonnet-5'} (Anthropic)`,
    };
  }

  return { llm: new FakeLlmProvider('legal', 'atencao'), label: 'fake (sem chave de LLM)' };
}
