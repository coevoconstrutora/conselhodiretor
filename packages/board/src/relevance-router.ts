import { stripJsonFences, type AgentId, type ILlmProvider } from '@conselho/providers';

/**
 * Roteador de relevância (Etapa "Orquestração" — Meeting Orchestrator).
 *
 * Hoje "quem reage" é decidido só por regex curadas (`packages/engines/src/
 * triggers.ts`) — rígido pra conselheiros CUSTOM (só palavra-chave literal,
 * sem sinônimo/contexto). Este roteador roda AO LADO do `TriggerDetector`
 * de sempre (nunca no lugar): usa um LLM rápido/barato pra pontuar cada
 * conselheiro por relevância semântica (0.00–1.00) contra um trecho da
 * discussão. Os selecionados viram `Candidate`s (packages/engines) que
 * passam pelo MESMO `BoardGatekeeper.submit()` — pausa/rate-limit/dedup
 * continuam intactos, únicos donos dessas regras.
 *
 * Nunca expõe o raciocínio do roteador (nem em log nem na UI) — só o score
 * final é usado, e mesmo esse fica interno (ver full-board.ts).
 */

export interface CounselorRelevanceInput {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly scope: string;
  /** Palavras-chave de reação de um conselheiro CUSTOM, se houver — vira pista extra no prompt. */
  readonly keywords?: readonly string[];
}

export interface RelevanceScore {
  readonly agentId: AgentId;
  readonly relevance: number;
}

export interface RelevanceRouterConfig {
  /** Abaixo disso, nunca invoca. Default 0.40. */
  readonly lowThreshold?: number;
  /** A partir disso, sempre invoca. Default 0.65. */
  readonly highThreshold?: number;
  /** Limite normal de conselheiros por tópico. Default 3. */
  readonly maxCounselors?: number;
  /** 4+ conselheiros pontuando isto ou mais ⇒ discussão "claramente multidisciplinar", ignora o limite. Default 0.75. */
  readonly strategicOverrideThreshold?: number;
}

const DEFAULT_LOW_THRESHOLD = 0.4;
const DEFAULT_HIGH_THRESHOLD = 0.65;
const DEFAULT_MAX_COUNSELORS = 3;
const DEFAULT_STRATEGIC_OVERRIDE = 0.75;

/** Sinal barato de risco/decisão/pergunta explícita — decide a faixa intermediária sem custo extra de LLM. */
const RISK_DECISION_RE = /\?|decis[ãa]o|risco|urgente|cr[íi]tico|problema|preocup|precisa(mos)? decidir/i;

export const RELEVANCE_ROUTER_SYSTEM =
  'Você é o roteador interno de um conselho de apoio à decisão de uma incorporadora imobiliária. ' +
  'Sua tarefa: dado um trecho de discussão e a lista de conselheiros (com o escopo de cada um), avalie a ' +
  'RELEVÂNCIA de cada conselheiro para esse trecho especificamente — 0.00 (nada a ver com o escopo dele) a ' +
  '1.00 (central ao escopo dele). Responda APENAS com um array JSON válido (sem cercas de código), um item ' +
  'por conselheiro da lista, nesta ordem: [{"agentId":"...","relevance":0.0}, ...]. ' +
  'Nunca inclua texto fora do array, nunca explique o motivo da nota.';

function buildPrompt(discussionUnit: string, counselors: readonly CounselorRelevanceInput[]): string {
  const roster = counselors
    .map((c) => `- ${c.agentId} (${c.displayName}): ${c.scope}${c.keywords?.length ? ` [palavras-chave: ${c.keywords.join(', ')}]` : ''}`)
    .join('\n');
  return `Conselheiros:\n${roster}\n\nTrecho da discussão:\n"""${discussionUnit}"""`;
}

/** Parse defensivo — item malformado é descartado, nunca derruba a rodada inteira (mesmo padrão de parseCaseState/parseCaseReview). */
function parseScores(raw: string, knownIds: ReadonlySet<AgentId>): RelevanceScore[] {
  try {
    const cleaned = stripJsonFences(raw);
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RelevanceScore[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const agentId = (item as Record<string, unknown>).agentId as AgentId;
      const relevanceRaw = (item as Record<string, unknown>).relevance;
      if (!knownIds.has(agentId) || typeof relevanceRaw !== 'number' || Number.isNaN(relevanceRaw)) continue;
      out.push({ agentId, relevance: Math.max(0, Math.min(1, relevanceRaw)) });
    }
    return out;
  } catch {
    return [];
  }
}

export class RelevanceRouter {
  private readonly lowThreshold: number;
  private readonly highThreshold: number;
  private readonly maxCounselors: number;
  private readonly strategicOverrideThreshold: number;

  constructor(
    private readonly llm: ILlmProvider,
    config: RelevanceRouterConfig = {},
  ) {
    this.lowThreshold = config.lowThreshold ?? DEFAULT_LOW_THRESHOLD;
    this.highThreshold = config.highThreshold ?? DEFAULT_HIGH_THRESHOLD;
    this.maxCounselors = config.maxCounselors ?? DEFAULT_MAX_COUNSELORS;
    this.strategicOverrideThreshold = config.strategicOverrideThreshold ?? DEFAULT_STRATEGIC_OVERRIDE;
  }

  /**
   * Conselheiros selecionados pra analisar este trecho, já com o filtro de
   * threshold + limite aplicado. Nunca lança: falha de rede/parse/provider
   * sem `completeText` degrada para `[]` — o board segue só com os triggers
   * regex de sempre (roteador é aditivo, nunca crítico).
   */
  async route(
    discussionUnit: string,
    counselors: readonly CounselorRelevanceInput[],
  ): Promise<RelevanceScore[]> {
    if (typeof this.llm.completeText !== 'function' || counselors.length === 0) return [];
    const knownIds = new Set(counselors.map((c) => c.agentId));
    let raw: string;
    try {
      const res = await this.llm.completeText({
        system: RELEVANCE_ROUTER_SYSTEM,
        prompt: buildPrompt(discussionUnit, counselors),
        maxTokens: 300,
      });
      raw = res.text;
    } catch {
      return [];
    }
    return this.select(discussionUnit, parseScores(raw, knownIds));
  }

  /** Threshold + limite de 3, com exceção multidisciplinar (Seção 3/4 do pedido). */
  private select(discussionUnit: string, scores: readonly RelevanceScore[]): RelevanceScore[] {
    const hasRiskSignal = RISK_DECISION_RE.test(discussionUnit);
    const eligible = scores.filter((s) => {
      if (s.relevance >= this.highThreshold) return true;
      if (s.relevance >= this.lowThreshold) return hasRiskSignal;
      return false;
    });
    const sorted = [...eligible].sort((a, b) => b.relevance - a.relevance);
    const strategicCount = sorted.filter((s) => s.relevance >= this.strategicOverrideThreshold).length;
    const limit = strategicCount > this.maxCounselors ? strategicCount : this.maxCounselors;
    return sorted.slice(0, limit);
  }
}
