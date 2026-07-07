import type { ContributionType, ContributionSeverity, AgentId } from '@conselho/providers';

/**
 * Trigger Detector por agente do Conselho.
 *
 * Regra BARATA sobre segmentos finais da transcrição — roda ANTES de qualquer
 * LLM (controle de custo). Catálogos derivados do domínio de incorporação
 * imobiliária. `severity: 'critical'` fura fila e ignora a pausa natural —
 * reservado para riscos de negócio graves (passivo jurídico, estouro de caixa,
 * embargo de obra), onde recall > precisão.
 *
 * O Presidente do Conselho NÃO tem triggers: ele só sintetiza.
 */

export interface AgentTriggerDef {
  readonly id: string;
  readonly agentId: AgentId;
  readonly pattern: RegExp;
  /** Dica de tipo de contribuição (⚠️ atencao / 💡 sugestao / 🔍 hipotese). */
  readonly typeHint: ContributionType;
  readonly severityHint: ContributionSeverity;
  /** Peso-base de relevância do gatilho (insumo do Scorer). */
  readonly baseWeight: number;
}

export interface TriggerMatch {
  readonly trigger: AgentTriggerDef;
  readonly matchedTerm: string;
  readonly segmentText: string;
  readonly at: number;
}

/** 1 — Engenharia e Lean Construction: custo de obra, prazo, produtividade. */
export const ENGENHARIA_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'engenharia-custo-prazo',
    agentId: 'engenharia',
    pattern:
      /or[çc]amento (de|da) obra|custo (de|da) obra|cronograma|prazo de entrega|atraso (de|da|na) obra|caminho cr[íi]tico|produtividade|desperd[íi]cio|retrabalho/i,
    typeHint: 'atencao',
    severityHint: 'normal',
    baseWeight: 0.7,
  },
  {
    id: 'engenharia-metodo-construtivo',
    agentId: 'engenharia',
    pattern:
      /m[ée]todo construtivo|alvenaria estrutural|parede de concreto|pr[ée]-?moldado|estrutura met[áa]lica|funda[çc][ãa]o|conten[çc][ãa]o|sondagem|terraplanagem/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.55,
  },
  {
    id: 'engenharia-obra-risco',
    agentId: 'engenharia',
    // embargo/acidente/interdição: risco grave — fura fila
    pattern:
      /embargo|interdi[çc][ãa]o|acidente (de|na) obra|colapso|recalque|infiltra[çc][ãa]o grave/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.9,
  },
  {
    id: 'engenharia-insumos',
    agentId: 'engenharia',
    pattern: /INCC|CUB|cimento|a[çc]o\b|insumos?|empreiteira|m[ãa]o de obra|subempreiteir/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
];

/** 2 — Vendas e Marketing: funil, campanhas, velocidade de vendas. */
export const VENDAS_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'vendas-funil',
    agentId: 'vendas',
    pattern:
      /funil|leads?|convers[ãa]o|corretor(es)?|imobili[áa]rias?|stand de vendas|plant[ãa]o de vendas|lan[çc]amento comercial/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
  {
    id: 'vendas-velocidade',
    agentId: 'vendas',
    pattern:
      /VSO|velocidade de vendas|estoque (de unidades|encalhado)|vendas? (fraca|parada|lenta)s?|distrato/i,
    typeHint: 'atencao',
    severityHint: 'normal',
    baseWeight: 0.7,
  },
  {
    id: 'vendas-campanha',
    agentId: 'vendas',
    pattern:
      /campanha|m[íi]dia|tr[áa]fego pago|redes sociais|branding|posicionamento|tabela de vendas|pre[çc]o de tabela/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
];

/** 3 — Inteligência de Mercado e Produto: concorrência, demanda, precificação. */
export const MERCADO_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'mercado-concorrencia',
    agentId: 'mercado',
    pattern:
      /concorr[êe]n(te|cia)|lan[çc]amentos? (do|no) (bairro|regi[ãa]o)|benchmark|pesquisa de mercado/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
  {
    id: 'mercado-produto',
    agentId: 'mercado',
    pattern:
      /tipologia|metragem|planta (do|de) apartamento|mix de unidades|p[úu]blico-?alvo|persona de cliente|demanda/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
  {
    id: 'mercado-precificacao',
    agentId: 'mercado',
    pattern:
      /pre[çc]o (do|por) m|m[²2]\b|precifica[çc][ãa]o|ticket m[ée]dio|valoriza[çc][ãa]o|pre[çc]o de venda/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.65,
  },
];

/** 4 — Arquitetura e Urbanismo: projeto, aprovações, zoneamento. */
export const ARQUITETURA_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'arquitetura-aprovacao',
    agentId: 'arquitetura',
    pattern:
      /aprova[çc][ãa]o (do|de) projeto|prefeitura|alvar[áa]|licen[çc]a|zoneamento|coeficiente de aproveitamento|potencial construtivo|outorga onerosa|gabarito|recuo/i,
    typeHint: 'atencao',
    severityHint: 'normal',
    baseWeight: 0.7,
  },
  {
    id: 'arquitetura-projeto',
    agentId: 'arquitetura',
    pattern:
      /projeto arquitet[ôo]nico|fachada|[áa]reas? comuns?|lazer|paisagismo|acessibilidade|insola[çc][ãa]o|ventila[çc][ãa]o/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
  {
    id: 'arquitetura-terreno',
    agentId: 'arquitetura',
    pattern: /terreno|topografia|implanta[çc][ãa]o|estudo de massa|viabilidade urban[íi]stica/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
];

/** 5 — Legal e Compliance: contratos, registro, riscos jurídicos. */
export const LEGAL_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'legal-incorporacao',
    agentId: 'legal',
    pattern:
      /registro de incorpora[çc][ãa]o|memorial (de incorpora[çc][ãa]o|descritivo)|cart[óo]rio|RGI|matr[íi]cula|patrim[ôo]nio de afeta[çc][ãa]o|SPE\b/i,
    typeHint: 'atencao',
    severityHint: 'normal',
    baseWeight: 0.7,
  },
  {
    id: 'legal-risco-grave',
    agentId: 'legal',
    // passivo jurídico grave — fura fila
    pattern:
      /a[çc][ãa]o judicial|processo (judicial|na justi[çc]a)|liminar|multa|autua[çc][ãa]o|passivo (jur[íi]dico|trabalhista|ambiental)|il[íi]cito|fraude/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.9,
  },
  {
    id: 'legal-contratos',
    agentId: 'legal',
    pattern:
      /contrato|distrato|cl[áa]usula|permuta|due diligence|LGPD|compliance|garantias?( contratuais?)?/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.55,
  },
];

/** 6 — Customer Success e Pós-venda: experiência do cliente, entrega, assistência. */
export const CS_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'cs-entrega',
    agentId: 'cs',
    pattern:
      /entrega (das|de) chaves|vistoria|habite-?se|manual do propriet[áa]rio|p[óo]s-?obra|assist[êe]ncia t[ée]cnica/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
  {
    id: 'cs-satisfacao',
    agentId: 'cs',
    pattern:
      /reclama[çc][ãa]o|reclame aqui|NPS\b|satisfa[çc][ãa]o do cliente|experi[êe]ncia do cliente|p[óo]s-?venda|relacionamento com o cliente/i,
    typeHint: 'atencao',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
];

/** 7 — CFO, Funding, Caixa e MCMV: fluxo de caixa, funding, viabilidade. */
export const CFO_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'cfo-caixa-risco',
    agentId: 'cfo',
    // estouro de caixa/insolvência — fura fila
    pattern:
      /estouro (de|do) caixa|caixa (negativo|estourado)|inadimpl[êe]ncia (alta|grave)|insolv[êe]ncia|calote/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.9,
  },
  {
    id: 'cfo-funding',
    agentId: 'cfo',
    pattern:
      /funding|financiamento ([àa]|da) produ[çc][ãa]o|plano empres[áa]rio|cr[ée]dito associativo|Caixa Econ[ôo]mica|alavancagem|d[íi]vida/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.65,
  },
  {
    id: 'cfo-mcmv',
    agentId: 'cfo',
    pattern: /MCMV|minha casa minha vida|faixa (1|2|3|um|dois|tr[êe]s)|enquadramento|subs[íi]dio|FGTS/i,
    typeHint: 'atencao',
    severityHint: 'normal',
    baseWeight: 0.7,
  },
  {
    id: 'cfo-viabilidade',
    agentId: 'cfo',
    pattern:
      /viabilidade|VGV|margem|TIR\b|payback|fluxo de caixa|exposi[çc][ãa]o de caixa|custo de capital|or[çc]amento\b/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.65,
  },
];

/** 8 — Futurista: tendências, tecnologia, cenários de longo prazo. */
export const FUTURISTA_TRIGGERS: readonly AgentTriggerDef[] = [
  {
    id: 'futurista-tendencias',
    agentId: 'futurista',
    pattern:
      /tend[êe]ncias?|futuro|longo prazo|cen[áa]rios?|intelig[êe]ncia artificial|automa[çc][ãa]o|sustentabilidade|ESG\b|energia solar|smart home|constru[çc][ãa]o industrializada/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
  {
    id: 'futurista-demografia',
    agentId: 'futurista',
    pattern:
      /demografia|envelhecimento|gera[çc][ãa]o Z|millennials|home office|trabalho remoto|novos h[áa]bitos/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
];

export const ALL_TRIGGERS: readonly AgentTriggerDef[] = [
  ...ENGENHARIA_TRIGGERS,
  ...VENDAS_TRIGGERS,
  ...MERCADO_TRIGGERS,
  ...ARQUITETURA_TRIGGERS,
  ...LEGAL_TRIGGERS,
  ...CS_TRIGGERS,
  ...CFO_TRIGGERS,
  ...FUTURISTA_TRIGGERS,
];

export class TriggerDetector {
  constructor(private readonly triggers: readonly AgentTriggerDef[] = ALL_TRIGGERS) {}

  /** Detecta gatilhos num segmento FINAL. Zero LLM. */
  detect(segmentText: string, at: number): TriggerMatch[] {
    const matches: TriggerMatch[] = [];
    for (const trigger of this.triggers) {
      const m = trigger.pattern.exec(segmentText);
      if (m) matches.push({ trigger, matchedTerm: m[0], segmentText, at });
    }
    return matches;
  }
}
