import {
  stripJsonFences,
  type ContributionSeverity,
  type ContributionType,
  type AgentId,
} from '@conselho/providers';

/**
 * Case Review (B4) — análise periódica do caso DESACOPLADA de keywords.
 *
 * Os triggers regex são o fast-path reativo (especialmente `critical`); o
 * review é o caminho deliberativo: em pausa natural, UMA chamada de LLM olha o
 * estado do caso + últimas falas + o que o board já disse e decide se ALGUMA
 * das 3 personas tem algo novo e útil — ou {"skip":true}.
 *
 * Regulatório inalterado: o output passa pelos MESMOS guarda-corpos (dedup
 * semântico, rate-limit, auditoria com triggeredBy 'case-review') e chega ao
 * médico como sugestão — o modelo sugere a persona, o CÓDIGO valida.
 */

export const CASE_REVIEW_SYSTEM =
  'Você é o analisador interno de um conselho de apoio à decisão de uma incorporadora imobiliária, com 8 conselheiros. ' +
  'Sua tarefa: analisar a PROGRESSÃO da reunião e decidir se algum conselheiro tem uma contribuição ' +
  'NOVA e útil AGORA — algo que os gatilhos automáticos não pegaram. ' +
  'REGRAS: (1) NÃO repita nada que o conselho já disse (mesmo com outras palavras); ' +
  '(2) a contribuição deve caber no escopo do conselheiro escolhido; ' +
  '(3) 1-3 frases em português do Brasil, tom de sugestão ("vale verificar", "considere") — a decisão é sempre do empresário; ' +
  '(4) na dúvida, PREFIRA skip — silêncio vale mais que ruído. ' +
  'Responda APENAS com JSON válido (sem cercas): ' +
  '{"skip":true} OU {"agentId":"engenharia|vendas|mercado|arquitetura|legal|cs|cfo|futurista","type":"atencao|sugestao|hipotese","severity":"normal|critical","text":"..."}.';

export interface CaseReviewContribution {
  readonly agentId: AgentId;
  readonly type: ContributionType;
  readonly severity: ContributionSeverity;
  readonly text: string;
}

export type CaseReviewResult = { skip: true } | CaseReviewContribution;

const PERSONAS = new Set<AgentId>(['engenharia', 'vendas', 'mercado', 'arquitetura', 'legal', 'cs', 'cfo', 'futurista']);
const TYPES = new Set<ContributionType>(['atencao', 'sugestao', 'hipotese']);
const SEVERITIES = new Set<ContributionSeverity>(['normal', 'critical']);

/**
 * Parse DEFENSIVO do output do review: agentId/type/severity são validados
 * contra os enums — o modelo sugere, o código decide. Malformado ⇒ null
 * (tratado como skip; o board nunca cai por causa do review).
 */
export function parseCaseReview(raw: string): CaseReviewResult | null {
  const cleaned = stripJsonFences(raw);
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    if (obj.skip === true) return { skip: true };
    const agentId = obj.agentId as AgentId;
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!PERSONAS.has(agentId) || !text) return null;
    return {
      agentId,
      type: TYPES.has(obj.type as ContributionType) ? (obj.type as ContributionType) : 'sugestao',
      severity: SEVERITIES.has(obj.severity as ContributionSeverity)
        ? (obj.severity as ContributionSeverity)
        : 'normal',
      text,
    };
  } catch {
    return null;
  }
}
