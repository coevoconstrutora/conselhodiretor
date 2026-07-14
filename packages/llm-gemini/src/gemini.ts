import { stripJsonFences } from '@conselho/providers';
import type {
  ILlmProvider,
  LlmCompletionRequest,
  TextCompletionRequest,
  AgentContribution,
  AgentId,
  ContributionType,
  ContributionSeverity,
} from '@conselho/providers';

/**
 * Adapter Google Gemini para `ILlmProvider` (NFR8 — mesmo contrato do
 * `llm-anthropic`; trocar de fornecedor é trocar UMA env var).
 *
 * Modelo default: alias **gemini-flash-latest** (sempre aponta para o Flash
 * estável mais novo) com FALLBACK automático de modelo em 503/404 — lição
 * aprendida: o "gemini-2.5-flash" foi descontinuado e passou a responder 404;
 * um alias + fallback evita que o board pare por modelo aposentado ou pico
 * de demanda.
 *
 * Respostas curtas do board: `thinkingConfig.thinkingBudget: 0` (Gemini 3
 * "pensa" por padrão e estouraria maxOutputTokens baixos). longForm
 * (relatórios) mantém o thinking do modelo e teto maior.
 */

export interface GeminiLlmConfig {
  readonly apiKey: string;
  readonly agentId: AgentId;
  readonly model?: string;
  /** Base da API (default v1beta pública) — trocável p/ proxy/teste. */
  readonly endpoint?: string;
  readonly maxTokens?: number;
  /** Documentos longos (ex.: relatório da reunião): remove o limite de 1-3 frases. */
  readonly longForm?: boolean;
  /** Telemetria (E10): tokens consumidos por chamada (custo NFR7). */
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  readonly fetchImpl?: typeof fetch;
  /** Timeout por chamada em ms (default 60s). */
  readonly timeoutMs?: number;
}

export class GeminiLlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'api' | 'parse' | 'network',
  ) {
    super(message);
    this.name = 'GeminiLlmError';
  }
}

export const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-flash-latest';
/** Ordem de fallback quando o modelo preferido responde 503 (pico) ou 404 (aposentado). */
export const MODEL_FALLBACKS = ['gemini-3-flash-preview', 'gemini-flash-lite-latest'] as const;

export function geminiConfigFromEnv(
  agentId: AgentId,
  env: NodeJS.ProcessEnv = process.env,
): GeminiLlmConfig {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiLlmError(
      'GEMINI_API_KEY ausente — configure a credencial do LLM no ambiente (.env).',
      'config',
    );
  }
  return { apiKey, agentId, model: env.GEMINI_MODEL || undefined };
}

function outputInstructions(longForm: boolean, allowSkip: boolean): string {
  return (
    'Responda APENAS com um objeto JSON válido (sem cercas de código), no formato: ' +
    '{"type":"atencao|sugestao|hipotese|sintese","severity":"normal|critical","text":"...","relevanceScore":0.0}. ' +
    (longForm
      ? 'O campo text deve conter o DOCUMENTO COMPLETO em markdown, com todas as seções e quebras de linha escapadas no JSON, em português do Brasil.'
      : 'O campo text deve ser curto (1-3 frases), em português do Brasil, em tom de sugestão.') +
    (allowSkip
      ? ' IMPORTANTE: se você NÃO tem nada NOVO e útil a acrescentar — algo que você ou um colega do conselho ' +
        'já disse nesta reunião, MESMO COM OUTRAS PALAVRAS, não é novo — responda APENAS {"skip":true}.'
      : '')
  );
}

interface GeminiResponse {
  modelVersion?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: { promptTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string };
}

const VALID_TYPES = new Set<ContributionType>(['atencao', 'sugestao', 'hipotese', 'sintese']);
const VALID_SEVERITIES = new Set<ContributionSeverity>(['normal', 'critical']);

export class GeminiLlmProvider implements ILlmProvider {
  constructor(private readonly config: GeminiLlmConfig) {
    if (!config.apiKey) {
      throw new GeminiLlmError('apiKey vazia — credencial do Gemini é obrigatória.', 'config');
    }
  }

  private modelCandidates(): string[] {
    const preferred = this.config.model ?? DEFAULT_MODEL;
    return [preferred, ...MODEL_FALLBACKS.filter((m) => m !== preferred)];
  }

  /**
   * generateContent com timeout + fallback de modelo em 503/404.
   * Erro de rede/timeout NUNCA escapa como exceção nativa de fetch.
   */
  private async generate(body: Record<string, unknown>): Promise<GeminiResponse> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const base = this.config.endpoint ?? DEFAULT_ENDPOINT;

    let lastError: GeminiLlmError | null = null;
    for (const model of this.modelCandidates()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(`${base}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        throw new GeminiLlmError(
          isAbort
            ? `Gemini API não respondeu em ${timeoutMs}ms (timeout).`
            : `Falha de rede ao chamar a Gemini API: ${err instanceof Error ? err.message : String(err)}`,
          'network',
        );
      } finally {
        clearTimeout(timer);
      }

      const data = (await response.json()) as GeminiResponse;
      if (response.ok) {
        // proveniência: registra qual modelo REALMENTE respondeu
        return { ...data, modelVersion: data.modelVersion ?? model };
      }
      lastError = new GeminiLlmError(
        `Gemini API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
      // 503 (pico de demanda) e 404 (modelo aposentado) ⇒ tenta o próximo modelo
      if (response.status !== 503 && response.status !== 404) throw lastError;
    }
    throw lastError ?? new GeminiLlmError('Nenhum modelo Gemini disponível.', 'api');
  }

  private reportUsage(data: GeminiResponse): void {
    const input = data.usageMetadata?.promptTokenCount ?? 0;
    const total = data.usageMetadata?.totalTokenCount ?? 0;
    // saída = total - entrada (inclui tokens de thinking, que também são cobrados)
    this.config.onUsage?.({ inputTokens: input, outputTokens: Math.max(0, total - input) });
  }

  private static extractText(data: GeminiResponse): string | undefined {
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    return text || undefined;
  }

  async complete(req: LlmCompletionRequest): Promise<AgentContribution> {
    const kbContext =
      req.context.length > 0
        ? `\n\nBase de conhecimento relevante:\n${req.context.map((c) => `- [${c.id}] ${c.text}`).join('\n')}`
        : '';
    const priorsBlock = req.priorContributions?.length
      ? `\n\nContribuições JÁ FEITAS pelo conselho nesta reunião (NÃO repita nenhuma, nem com outras palavras):\n${req.priorContributions
          .map((p) => `- ${p}`)
          .join('\n')}`
      : '';
    const longForm = this.config.longForm ?? false;

    const data = await this.generate({
      systemInstruction: {
        parts: [{ text: `${req.system}\n\n${outputInstructions(longForm, req.allowSkip ?? false)}` }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Transcrição recente da reunião:\n"""${req.transcript}"""${kbContext}${priorsBlock}` },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: this.config.maxTokens ?? (longForm ? 8000 : 400),
        // resposta curta do board: sem thinking (previsível em latência/custo);
        // longForm mantém o raciocínio default do modelo
        ...(longForm ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    });

    this.reportUsage(data);
    const text = GeminiLlmProvider.extractText(data);
    if (!text) {
      throw new GeminiLlmError(
        `Resposta sem texto (finishReason: ${data.candidates?.[0]?.finishReason ?? 'desconhecido'}).`,
        'parse',
      );
    }

    const parsed = parseContribution(text);
    if (parsed.skip) {
      return {
        agentId: this.config.agentId,
        type: 'sugestao',
        severity: 'normal',
        text: '',
        skip: true,
        modelVersion: data.modelVersion,
      };
    }
    return {
      agentId: this.config.agentId,
      type: parsed.type,
      severity: parsed.severity,
      text: parsed.text,
      relevanceScore: parsed.relevanceScore,
      triggeredBy: undefined, // o orchestrator conhece o gatilho, não o modelo
      kbSources: req.context.map((c) => c.id),
      modelVersion: data.modelVersion,
    };
  }

  /** Completion de texto livre (CaseState/case review) — sem contrato JSON. */
  async completeText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
    const data = await this.generate({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 500,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    this.reportUsage(data);
    const text = GeminiLlmProvider.extractText(data);
    if (!text) {
      throw new GeminiLlmError(
        `Resposta sem texto (finishReason: ${data.candidates?.[0]?.finishReason ?? 'desconhecido'}).`,
        'parse',
      );
    }
    return { text, modelVersion: data.modelVersion };
  }
}

interface ParsedContribution {
  type: ContributionType;
  severity: ContributionSeverity;
  text: string;
  relevanceScore?: number;
  skip?: true;
}

/** Parse tolerante do JSON do modelo (aceita cercas de código por robustez). */
export function parseContribution(raw: string): ParsedContribution {
  const cleaned = stripJsonFences(raw);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new GeminiLlmError(`JSON inválido do modelo: ${raw.slice(0, 120)}`, 'parse');
  }
  if (obj.skip === true) {
    return { type: 'sugestao', severity: 'normal', text: '', skip: true };
  }
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) throw new GeminiLlmError('Contribuição sem texto.', 'parse');
  const type = VALID_TYPES.has(obj.type as ContributionType)
    ? (obj.type as ContributionType)
    : 'sugestao';
  const severity = VALID_SEVERITIES.has(obj.severity as ContributionSeverity)
    ? (obj.severity as ContributionSeverity)
    : 'normal';
  const relevanceScore = typeof obj.relevanceScore === 'number' ? obj.relevanceScore : undefined;
  return { type, severity, text, relevanceScore };
}
