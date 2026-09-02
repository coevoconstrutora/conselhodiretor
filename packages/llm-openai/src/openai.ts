import { stripJsonFences } from '@conselho/providers';
import type {
  ILlmProvider,
  LlmCompletionRequest,
  TextCompletionRequest,
  AgentContribution,
  AgentId,
  ContributionType,
  ContributionSeverity,
  ContributionUrgency,
} from '@conselho/providers';

/**
 * Adapter OpenAI para `ILlmProvider` (NFR8) — mesmo contrato dos adapters
 * Anthropic/Gemini, trocando só o vendor. Chat Completions API (sem SDK de
 * vendor), com `response_format: json_object` para reforçar saída JSON válida
 * (a instrução textual de formato continua indo no `system`, pois a API exige
 * a palavra "JSON" no prompt quando esse modo é usado).
 *
 * Default: **gpt-5.6-luna** — tier mais rápido/barato da família GPT-5.6
 * (sucessora do gpt-5-mini), custo/latência adequados às contribuições
 * curtas do board; o modelo pode subir por persona trocando só
 * `OPENAI_MODEL`. Modelos gpt-5.x exigem `max_completion_tokens` (a API
 * rejeita `max_tokens` neles) e "pensam" por default como o Gemini 3 — sem
 * `reasoning_effort: 'minimal'` o raciocínio interno consome o teto de
 * tokens de saídas curtas e a resposta some (mesma lição do Gemini, CLAUDE.md).
 */

export interface OpenAiLlmConfig {
  readonly apiKey: string;
  readonly agentId: AgentId;
  readonly model?: string;
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

export class OpenAiLlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'api' | 'parse' | 'network',
  ) {
    super(message);
    this.name = 'OpenAiLlmError';
  }
}

/** Timeout default de uma chamada à Chat Completions API (ms). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * fetch com timeout (AbortController) e erro de rede SEMPRE encapsulado em
 * OpenAiLlmError — nenhuma exceção nativa de fetch escapa do adapter.
 */
async function fetchWithTimeout(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new OpenAiLlmError(
      isAbort
        ? `Chat Completions API não respondeu em ${timeoutMs}ms (timeout).`
        : `Falha de rede ao chamar a Chat Completions API: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-5.6-luna';

/** gpt-5.x "pensa" por default — reasoning mínimo pra não estourar tokens curtos. */
function isReasoningModel(model: string): boolean {
  return model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');
}

export function openAiConfigFromEnv(
  agentId: AgentId,
  env: NodeJS.ProcessEnv = process.env,
): OpenAiLlmConfig {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAiLlmError(
      'OPENAI_API_KEY ausente — configure a credencial do LLM no ambiente (.env).',
      'config',
    );
  }
  return { apiKey, agentId };
}

function outputInstructions(longForm: boolean, allowSkip: boolean): string {
  return (
    'Responda APENAS com um objeto JSON válido, no formato: ' +
    '{"type":"atencao|sugestao|hipotese|sintese","severity":"normal|critical","text":"...","relevanceScore":0.0,' +
    '"urgency":"low|medium|high|critical","category":"...","headline":"...","recommendation":"...","question":"..."}. ' +
    'Os campos urgency/category/headline/recommendation/question são OPCIONAIS — preencha só quando fizer sentido: ' +
    'headline é um título curto (até 8 palavras) pro card; recommendation é UMA ação concreta sugerida; question é ' +
    'uma pergunta direta ao empresário, só se houver uma pendente. ' +
    (longForm
      ? 'O campo text deve conter o DOCUMENTO COMPLETO em markdown, com todas as seções e quebras de linha escapadas no JSON, em português do Brasil.'
      : 'O campo text deve ser curto (1-3 frases), em português do Brasil, em tom de sugestão.') +
    (allowSkip
      ? ' IMPORTANTE: se você NÃO tem nada NOVO e útil a acrescentar — algo que você ou um colega do conselho ' +
        'já disse nesta reunião, MESMO COM OUTRAS PALAVRAS, não é novo — responda APENAS {"skip":true}.'
      : '')
  );
}

interface OpenAiResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

const VALID_TYPES = new Set<ContributionType>(['atencao', 'sugestao', 'hipotese', 'sintese']);
const VALID_SEVERITIES = new Set<ContributionSeverity>(['normal', 'critical']);

export class OpenAiLlmProvider implements ILlmProvider {
  constructor(private readonly config: OpenAiLlmConfig) {
    if (!config.apiKey) {
      throw new OpenAiLlmError('apiKey vazia — credencial da OpenAI é obrigatória.', 'config');
    }
  }

  async complete(req: LlmCompletionRequest): Promise<AgentContribution> {
    const kbContext =
      req.context.length > 0
        ? `\n\nBase de conhecimento relevante:\n${req.context.map((c) => `- [${c.id}] ${c.text}`).join('\n')}`
        : '';
    // B1 — anti-repetição: o modelo VÊ o que o conselho já disse nesta reunião
    const priorsBlock = req.priorContributions?.length
      ? `\n\nContribuições JÁ FEITAS pelo conselho nesta reunião (NÃO repita nenhuma, nem com outras palavras):\n${req.priorContributions
          .map((p) => `- ${p}`)
          .join('\n')}`
      : '';

    const data = await this.callApi(
      `${req.system}\n\n${outputInstructions(this.config.longForm ?? false, req.allowSkip ?? false)}`,
      `Transcrição recente da reunião:\n"""${req.transcript}"""${kbContext}${priorsBlock}`,
      this.config.maxTokens ?? 300,
      true,
      req.model,
      req.reasoningEffort,
    );

    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new OpenAiLlmError('Resposta sem conteúdo.', 'parse');

    const parsed = parseContribution(text);
    if (parsed.skip) {
      // B1: o modelo declarou não ter nada novo — o orchestrator descarta
      return {
        agentId: this.config.agentId,
        type: 'sugestao',
        severity: 'normal',
        text: '',
        skip: true,
        modelVersion: data.model ?? this.config.model ?? DEFAULT_MODEL,
      };
    }
    return {
      agentId: this.config.agentId,
      type: parsed.type,
      severity: parsed.severity,
      text: parsed.text,
      relevanceScore: parsed.relevanceScore,
      urgency: parsed.urgency,
      category: parsed.category,
      headline: parsed.headline,
      recommendation: parsed.recommendation,
      question: parsed.question,
      triggeredBy: undefined, // o orchestrator conhece o gatilho, não o modelo
      kbSources: req.context.map((c) => c.id),
      modelVersion: data.model ?? this.config.model ?? DEFAULT_MODEL,
    };
  }

  /**
   * B3 — completion de texto livre (CaseState/case review): mesma Chat
   * Completions API, sem o contrato JSON de contribuição nem response_format
   * forçado. Também reporta usage (custo E10).
   */
  async completeText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
    const data = await this.callApi(req.system, req.prompt, req.maxTokens ?? 400, false, req.model, req.reasoningEffort);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new OpenAiLlmError('Resposta sem conteúdo.', 'parse');
    return { text, modelVersion: data.model ?? this.config.model ?? DEFAULT_MODEL };
  }

  private async callApi(
    system: string,
    user: string,
    maxTokens: number,
    jsonMode = true,
    modelOverride?: string,
    reasoningEffortOverride?: string,
  ): Promise<OpenAiResponse> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const model = modelOverride || this.config.model || DEFAULT_MODEL;
    // reasoning models "pensam" por default — sem um esforço explícito, o
    // raciocínio interno consome o teto de tokens de saídas curtas e a
    // resposta some (mesma lição do Gemini, CLAUDE.md). 'none' é o piso
    // seguro quando ninguém pediu um nível específico (Etapa "IA por
    // conselheiro" — reasoningEffortOverride normalmente vem configurado).
    const effort = reasoningEffortOverride || (isReasoningModel(model) ? 'none' : undefined);
    const response = await fetchWithTimeout(
      doFetch,
      this.config.endpoint ?? DEFAULT_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: maxTokens,
          ...(effort ? { reasoning_effort: effort } : {}),
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      },
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    const data = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new OpenAiLlmError(
        `Chat Completions API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }

    this.config.onUsage?.({
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    });

    return data;
  }
}

interface ParsedContribution {
  type: ContributionType;
  severity: ContributionSeverity;
  text: string;
  relevanceScore?: number;
  skip?: true;
  urgency?: ContributionUrgency;
  category?: string;
  headline?: string;
  recommendation?: string;
  question?: string;
}

const VALID_URGENCIES = new Set<ContributionUrgency>(['low', 'medium', 'high', 'critical']);

/** Parse tolerante do JSON do modelo (aceita cercas de código por robustez). */
export function parseContribution(raw: string): ParsedContribution {
  const cleaned = stripJsonFences(raw);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new OpenAiLlmError(`JSON inválido do modelo: ${raw.slice(0, 120)}`, 'parse');
  }
  if (obj.skip === true) {
    return { type: 'sugestao', severity: 'normal', text: '', skip: true };
  }
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) throw new OpenAiLlmError('Contribuição sem texto.', 'parse');
  const type = VALID_TYPES.has(obj.type as ContributionType)
    ? (obj.type as ContributionType)
    : 'sugestao';
  const severity = VALID_SEVERITIES.has(obj.severity as ContributionSeverity)
    ? (obj.severity as ContributionSeverity)
    : 'normal';
  const relevanceScore = typeof obj.relevanceScore === 'number' ? obj.relevanceScore : undefined;
  const urgency = VALID_URGENCIES.has(obj.urgency as ContributionUrgency)
    ? (obj.urgency as ContributionUrgency)
    : undefined;
  const category = typeof obj.category === 'string' && obj.category.trim() ? obj.category.trim() : undefined;
  const headline = typeof obj.headline === 'string' && obj.headline.trim() ? obj.headline.trim() : undefined;
  const recommendation =
    typeof obj.recommendation === 'string' && obj.recommendation.trim() ? obj.recommendation.trim() : undefined;
  const question = typeof obj.question === 'string' && obj.question.trim() ? obj.question.trim() : undefined;
  return { type, severity, text, relevanceScore, urgency, category, headline, recommendation, question };
}
