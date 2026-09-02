/**
 * Configuração central de IA por conselheiro (Etapa "IA por conselheiro") —
 * modelo de raciocínio, nível de raciocínio, voz, estilo de voz e
 * velocidade da fala. ÚNICA fonte de verdade dos valores permitidos: o
 * formulário do conselheiro, a validação no servidor e a execução (LLM/TTS)
 * leem daqui — nunca duplicar estas listas em outro componente.
 *
 * Regra de segurança (NUNCA confiar em valor vindo do cliente): todo valor
 * de model/reasoningEffort/voice/speechRate É VALIDADO contra estas listas
 * antes de persistir ou usar — um valor desconhecido cai no default.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface ReasoningModelOption extends SelectOption {
  readonly description: string;
}

/** Modelos de raciocínio suportados — identificadores reais da OpenAI, nunca o label traduzido. */
export const REASONING_MODELS: readonly ReasoningModelOption[] = [
  {
    value: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Rápido e econômico. Ideal para análises objetivas e alta frequência.',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    description: 'Equilíbrio entre profundidade, velocidade e custo.',
  },
  {
    value: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    description: 'Maior capacidade analítica. Indicado para decisões complexas e estratégicas.',
  },
] as const;

export const DEFAULT_AI_MODEL = 'gpt-5.6-luna';

/** Níveis de esforço de raciocínio — mesmos valores aceitos pela API da OpenAI (gpt-5.x). */
export const REASONING_EFFORTS: readonly SelectOption[] = [
  { value: 'none', label: 'Nenhum' },
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
  { value: 'xhigh', label: 'Muito alto' },
  { value: 'max', label: 'Máximo' },
] as const;

export const DEFAULT_REASONING_EFFORT = 'medium';

/**
 * As 9 vozes aceitas pelo endpoint de fala (`/v1/audio/speech` — nem todo o
 * catálogo da OpenAI funciona ali, ver apps/web/lib/tts-voices.ts). Única
 * lista de vozes do app — o formulário do conselheiro e o fallback por
 * agentId padrão leem daqui.
 */
export const VOICES: readonly SelectOption[] = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'ash', label: 'Ash' },
  { value: 'coral', label: 'Coral' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'nova', label: 'Nova' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'sage', label: 'Sage' },
  { value: 'shimmer', label: 'Shimmer' },
] as const;

/** Velocidades de fala suportadas — select compacto, não input numérico livre. */
export const SPEECH_RATES: readonly { value: number; label: string }[] = [
  { value: 0.9, label: '0.90x — Mais pausada' },
  { value: 1.0, label: '1.00x — Normal' },
  { value: 1.1, label: '1.10x — Dinâmica' },
  { value: 1.2, label: '1.20x — Rápida' },
] as const;

export const DEFAULT_SPEECH_RATE = 1.0;

/** Texto fixo do preview de voz — nunca o texto que o usuário digitar (custo/abuso). */
export const VOICE_PREVIEW_TEXT =
  'Olá. Vou participar desta reunião como seu conselheiro e apresentar minha análise de forma objetiva, técnica e independente.';

export const VOICE_STYLE_MAX = 500;

export function isValidAiModel(value: unknown): value is string {
  return typeof value === 'string' && REASONING_MODELS.some((m) => m.value === value);
}

export function isValidReasoningEffort(value: unknown): value is string {
  return typeof value === 'string' && REASONING_EFFORTS.some((e) => e.value === value);
}

export function isValidVoice(value: unknown): value is string {
  return typeof value === 'string' && VOICES.some((v) => v.value === value);
}

export function isValidSpeechRate(value: unknown): value is number {
  return typeof value === 'number' && SPEECH_RATES.some((r) => r.value === value);
}

export function findReasoningModel(value: string | null | undefined): ReasoningModelOption | undefined {
  return REASONING_MODELS.find((m) => m.value === value);
}

/**
 * Configuração do Presidente (governança — distinta da config por
 * conselheiro acima): nível de intervenção na reunião. Único ponto de
 * verdade, mesmo padrão das listas de cima.
 */
export const INTERVENTION_LEVELS: readonly (SelectOption & { readonly description: string })[] = [
  {
    value: 'low',
    label: 'Baixo',
    description: 'O Presidente majoritariamente observa e só fala quando explicitamente solicitado.',
  },
  {
    value: 'moderate',
    label: 'Moderado',
    description:
      'O Presidente intervém quando há divergência relevante, decisão em aberto, risco material ou informação importante faltando.',
  },
  {
    value: 'active',
    label: 'Ativo',
    description: 'O Presidente conduz a reunião mais ativamente e solicita análises com mais frequência.',
  },
] as const;

export const DEFAULT_INTERVENTION_LEVEL = 'moderate';

export function isValidInterventionLevel(value: unknown): value is string {
  return typeof value === 'string' && INTERVENTION_LEVELS.some((l) => l.value === value);
}

/**
 * Política de consenso do Presidente — hoje só existe UM valor válido (nunca
 * fabricar consenso entre conselheiros divergentes). Modelado como catálogo
 * (não uma string solta) para caso outras políticas sejam adicionadas depois.
 */
export const CONSENSUS_POLICIES: readonly SelectOption[] = [
  { value: 'preserve_disagreement', label: 'Preservar divergências' },
] as const;

export const DEFAULT_CONSENSUS_POLICY = 'preserve_disagreement';

export function isValidConsensusPolicy(value: unknown): value is string {
  return typeof value === 'string' && CONSENSUS_POLICIES.some((p) => p.value === value);
}
