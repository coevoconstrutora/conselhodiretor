/**
 * Dedup semântico BARATO (B2 — anti-repetição, zero LLM).
 *
 * O Deduplicator do gate compara topicKey EXATO numa janela de 60s — repetição
 * do mesmo tema minutos depois (ou parafraseada) passava direto. Aqui: keywords
 * normalizadas (sem acentos, sem stopwords pt-BR) + similaridade de Jaccard,
 * contra a consulta INTEIRA. Determinístico e testável.
 */

/** Stopwords pt-BR — funcionais/comuns em fala de consulta (sem termos clínicos). */
const STOPWORDS_PT = new Set([
  'a', 'o', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'uns', 'umas', 'com', 'sem', 'por', 'para', 'pra', 'pro', 'que',
  'se', 'ao', 'aos', 'as', 'os', 'ou', 'mas', 'mais', 'menos', 'muito', 'muita',
  'bem', 'como', 'quando', 'onde', 'porque', 'pois', 'ja', 'ainda', 'tambem',
  'entao', 'assim', 'aqui', 'ali', 'la', 'esse', 'essa', 'isso', 'este', 'esta',
  'isto', 'aquele', 'aquela', 'aquilo', 'seu', 'sua', 'seus', 'suas', 'meu',
  'minha', 'ele', 'ela', 'eles', 'elas', 'voce', 'nos', 'eu', 'me', 'te', 'lhe',
  'ser', 'estar', 'ter', 'foi', 'era', 'sao', 'esta', 'estao', 'tem', 'tinha',
  'vai', 'vamos', 'vou', 'pode', 'antes', 'depois', 'sobre', 'entre', 'cada',
  'vale', 'checar', 'considere', 'considerar', 'sugiro', 'avaliar', 'importante',
  'paciente', 'consulta', 'medico', 'caso', 'dia', 'hoje', 'nao', 'sim',
]);

/** Normaliza e extrai o vocabulário significativo do texto (lowercase, sem acentos). */
export function keywordSet(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove diacríticos combinantes (acentos)
  const words = normalized.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS_PT.has(w));
  return new Set(words);
}

/** Similaridade de Jaccard entre dois conjuntos (0 = disjuntos, 1 = idênticos). */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export interface SemanticDedupResult {
  readonly duplicate: boolean;
  /** Maior similaridade encontrada contra o histórico (diagnóstico/telemetria). */
  readonly score: number;
}

/**
 * Memória de textos exibidos na consulta INTEIRA (sem janela de tempo):
 * um texto novo similar demais a qualquer anterior é duplicata semântica.
 */
export class SemanticDeduplicator {
  private readonly seen: Array<Set<string>> = [];
  private readonly threshold: number;

  constructor(opts: { threshold?: number } = {}) {
    this.threshold = opts.threshold ?? 0.5;
  }

  isDuplicate(text: string): SemanticDedupResult {
    const candidate = keywordSet(text);
    let best = 0;
    for (const previous of this.seen) {
      const score = jaccard(candidate, previous);
      if (score > best) best = score;
      if (best >= this.threshold) return { duplicate: true, score: best };
    }
    return { duplicate: false, score: best };
  }

  register(text: string): void {
    this.seen.push(keywordSet(text));
  }
}
