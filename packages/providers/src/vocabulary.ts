/**
 * Vocabulário de negócio curado para boost do STT (keyterm/keywords do Deepgram).
 *
 * Termos do domínio de incorporação imobiliária que o STT genérico tende a
 * corromper ou não priorizar em pt-BR. A lista NÃO deve crescer indefinidamente:
 * o parâmetro legado `keywords` degrada com listas longas — manter curada
 * (~60-80 termos), priorizando siglas e jargão que mudam decisões.
 */
export const BUSINESS_VOCABULARY: readonly string[] = [
  // financeiro / funding
  'VGV',
  'TIR',
  'payback',
  'fluxo de caixa',
  'exposição de caixa',
  'funding',
  'plano empresário',
  'crédito associativo',
  'alavancagem',
  'inadimplência',
  'distrato',
  'MCMV',
  'Minha Casa Minha Vida',
  'FGTS',
  'subsídio',
  'enquadramento',
  'patrimônio de afetação',
  'RET',
  'SPE',
  // obra / engenharia
  'INCC',
  'CUB',
  'cronograma',
  'caminho crítico',
  'empreiteira',
  'terraplanagem',
  'sondagem',
  'fundação',
  'contenção',
  'alvenaria estrutural',
  // 'parede de concreto' foi removido: é vocabulário comum (não jargão),
  // e o boost estava puxando falso-positivo em cima de palavras parecidas
  // ("pessoal" → "parede") — boost deve ser reservado a termos que um STT
  // genérico realmente erraria sem ajuda.
  'pré-moldado',
  'lean construction',
  'retrabalho',
  'habite-se',
  // jurídico / registro
  'registro de incorporação',
  'memorial descritivo',
  'memorial de incorporação',
  'RGI',
  'matrícula',
  'cartório',
  'due diligence',
  'permuta',
  'liminar',
  'usucapião',
  'LGPD',
  // urbanístico / projeto
  'zoneamento',
  'coeficiente de aproveitamento',
  'potencial construtivo',
  'outorga onerosa',
  'gabarito',
  'recuo',
  'alvará',
  'estudo de massa',
  'implantação',
  'tipologia',
  'metragem',
  // comercial / mercado
  'VSO',
  'velocidade de vendas',
  'stand de vendas',
  'tabela de vendas',
  'ticket médio',
  'preço por metro quadrado',
  'landbank',
  'lançamento',
  'corretor',
  'imobiliária',
  'funil',
  'leads',
  'NPS',
  'pós-venda',
  'vistoria',
  'entrega de chaves',
];
