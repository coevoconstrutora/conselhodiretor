import type {
  IKnowledgeRetriever,
  ILlmProvider,
  AgentContribution,
  AgentId,
} from '@conselho/providers';
import { companyProfileBlock } from './company-profile';

/**
 * Agent Reasoner.
 *
 * Após o Gate aprovar um candidato: recupera KB SÓ do namespace do agente →
 * chama `ILlmProvider` com prompt RESTRITO ao escopo → contribuição PT-BR
 * ancorada no contexto. `kbSources` = ids dos chunks usados (proveniência →
 * auditoria). Só conhece interfaces.
 */

export interface AgentProfile {
  readonly agentId: AgentId;
  readonly displayName: string;
  /** Escopo da especialidade (docs/agents-knowledge-seed.md). */
  readonly scope: string;
}

/**
 * Template dos 9 agentes do Conselho — ponto de partida de TODA empresa nova
 * (clonado, nunca compartilhado por referência). Editar aqui muda o DEFAULT
 * para empresas futuras; não afeta empresas já criadas (elas têm sua própria
 * cópia em `agent_profile`, carregada via `applyAgentProfileOverrides`).
 */
export const DEFAULT_AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  engenharia: {
    agentId: 'engenharia',
    displayName: 'Engenharia e Lean Construction',
    scope:
      'custos e orçamento de obra, cronograma e caminho crítico, produtividade, método construtivo, insumos (INCC/CUB), gestão de empreiteiras e lean construction',
  },
  vendas: {
    agentId: 'vendas',
    displayName: 'Vendas e Marketing',
    scope:
      'funil comercial, geração de leads, corretores e imobiliárias, velocidade de vendas (VSO), campanhas, mídia, branding, tabela de vendas e combate a distratos',
  },
  mercado: {
    agentId: 'mercado',
    displayName: 'Inteligência de Mercado e Produto',
    scope:
      'análise de concorrência, demanda, tipologia e mix de unidades, público-alvo, precificação por m², pesquisa de mercado e definição de produto imobiliário',
  },
  arquitetura: {
    agentId: 'arquitetura',
    displayName: 'Arquitetura e Urbanismo',
    scope:
      'projeto arquitetônico, aprovações e licenças, zoneamento, coeficiente de aproveitamento, potencial construtivo, implantação, áreas comuns e viabilidade urbanística',
  },
  legal: {
    agentId: 'legal',
    displayName: 'Legal e Compliance',
    scope:
      'contratos e distratos, registro de incorporação, memorial, patrimônio de afetação, SPE, due diligence de terrenos, riscos jurídicos, LGPD e compliance',
  },
  cs: {
    agentId: 'cs',
    displayName: 'Customer Success e Pós-venda',
    scope:
      'experiência do cliente, vistoria e entrega de chaves, habite-se, assistência técnica pós-obra, NPS, gestão de reclamações e relacionamento no pós-venda',
  },
  cfo: {
    agentId: 'cfo',
    displayName: 'CFO — Funding, Caixa e MCMV',
    scope:
      'fluxo de caixa e exposição, funding e financiamento à produção, viabilidade (VGV, margem, TIR), enquadramento MCMV, crédito associativo e gestão de dívida',
  },
  futurista: {
    agentId: 'futurista',
    displayName: 'Futurista',
    scope:
      'tendências de longo prazo, tecnologia e IA aplicada à construção, sustentabilidade e ESG, mudanças demográficas e novos hábitos de moradia',
  },
  presidente: {
    agentId: 'presidente',
    displayName: 'Presidente do Conselho',
    scope:
      'síntese e moderação do conselho: integra as contribuições dos conselheiros, expõe divergências com transparência e devolve a decisão ao empresário',
  },
};

function cloneDefaultProfiles(): Record<AgentId, AgentProfile> {
  const clone: Record<AgentId, AgentProfile> = {};
  for (const [key, value] of Object.entries(DEFAULT_AGENT_PROFILES)) {
    clone[key] = { ...value };
  }
  return clone;
}

/**
 * Perfis por EMPRESA (multi-tenant): cada `companyId` tem sua própria cópia
 * em memória, isolada das demais — editar o CFO da Velkor NUNCA afeta a
 * Coevo, mesmo com as duas ativas no mesmo processo. Populada sob demanda
 * (primeiro acesso clona o template); `applyAgentProfileOverrides` é quem
 * carrega a personalização persistida (`agent_profile`) por cima.
 */
const profilesByCompany = new Map<string, Record<AgentId, AgentProfile>>();

export function getAgentProfiles(companyId: string): Record<AgentId, AgentProfile> {
  let profiles = profilesByCompany.get(companyId);
  if (!profiles) {
    profiles = cloneDefaultProfiles();
    profilesByCompany.set(companyId, profiles);
  }
  return profiles;
}

/** System prompt restrito por agente — anti-extrapolação, tom de sugestão. */
export function buildAgentSystem(profile: AgentProfile, companyId: string): string {
  return (
    `Você é ${profile.displayName}, membro do conselho consultivo de IA de uma incorporadora imobiliária, ` +
    `assistindo a uma reunião de negócios ao vivo. ` +
    `Seu escopo é ESTRITAMENTE: ${profile.scope}. ` +
    `REGRAS INEGOCIÁVEIS: (1) NUNCA opine fora do seu escopo — se o tema pertence a outro conselheiro, ` +
    `não contribua sobre ele; (2) ancore-se no contexto de conhecimento fornecido e no que foi dito na reunião — ` +
    `não invente números nem fatos; (3) responda em português do Brasil, em 1-3 frases, em tom de sugestão ` +
    `("vale verificar", "considere") ou de pergunta instigante — nunca de comando: a decisão é sempre do empresário; ` +
    `(4) NÃO repita contribuições já feitas pelo conselho (mesmo com outras palavras) — analise a PROGRESSÃO ` +
    `da reunião e só contribua com o que é NOVO e útil agora.` +
    companyProfileBlock(companyId)
  );
}

/**
 * Sobrepõe nome/escopo de perfis com a personalização do DONO (persistida em
 * `agent_profile`, agora por empresa). Muta o registry DAQUELA empresa —
 * todos os consumidores (reasoner, síntese, case review, relatórios) que
 * chamam `getAgentProfiles(companyId)` leem o MESMO objeto — vale
 * imediatamente, sem restart. `agentId` nunca é sobreposto.
 */
export function applyAgentProfileOverrides(
  companyId: string,
  overrides: ReadonlyArray<{ agentId: AgentId; displayName?: string; scope?: string }>,
): void {
  const profiles = getAgentProfiles(companyId);
  for (const o of overrides) {
    const profile = profiles[o.agentId];
    if (profile) {
      profiles[o.agentId] = {
        ...profile,
        displayName: o.displayName?.trim() || profile.displayName,
        scope: o.scope?.trim() || profile.scope,
      };
    } else if (o.displayName?.trim() && o.scope?.trim()) {
      // conselheiro CUSTOM desta empresa — não estava no template padrão
      // (DEFAULT_AGENT_PROFILES), `agent_profile` no banco é a fonte de verdade.
      profiles[o.agentId] = {
        agentId: o.agentId,
        displayName: o.displayName.trim(),
        scope: o.scope.trim(),
      };
    }
  }
}

/** Remove um conselheiro CUSTOM da memória desta empresa (nunca os padrão). */
export function removeAgentProfile(companyId: string, agentId: AgentId): void {
  const profiles = getAgentProfiles(companyId);
  if (agentId in DEFAULT_AGENT_PROFILES) return; // nunca remove um dos 9 padrão
  delete profiles[agentId];
}

/** Contribuição anterior do board (B1 — memória anti-repetição). */
export interface PriorContribution {
  readonly agentId: AgentId;
  readonly text: string;
}

export interface ReasonInput {
  readonly agentId: AgentId;
  /** Texto do gatilho/segmento que motivou (query do retrieve). */
  readonly query: string;
  /** Janela recente da transcrição (contexto da conversa). */
  readonly transcript: string;
  /** Chunks a recuperar (default 3). */
  readonly k?: number;
  /** B1: contribuições já exibidas nesta consulta (o modelo não deve repeti-las). */
  readonly previousContributions?: readonly PriorContribution[];
  /** B3: bloco compacto do ESTADO DO CASO (CaseStateTracker) — progressão da consulta inteira. */
  readonly caseState?: string;
}

export class AgentReasoner {
  constructor(
    private readonly companyId: string,
    private readonly retriever: IKnowledgeRetriever,
    private readonly llm: ILlmProvider,
  ) {}

  async reason(input: ReasonInput): Promise<AgentContribution> {
    const profiles = getAgentProfiles(this.companyId);
    const profile = profiles[input.agentId];
    if (!profile) throw new Error(`Conselheiro desconhecido: ${input.agentId} (empresa ${this.companyId}).`);
    // FR21: recuperação SÓ no namespace da persona
    const context = await this.retriever.retrieve(input.agentId, input.query, input.k ?? 3);
    const priors = (input.previousContributions ?? []).map(
      (c) => `[${profiles[c.agentId]?.displayName ?? c.agentId}] ${c.text}`,
    );
    const contribution = await this.llm.complete({
      system: buildAgentSystem(profile, this.companyId),
      context,
      // B3: o estado do caso dá ao modelo a PROGRESSÃO da consulta inteira,
      // não só a janela curta de transcript
      transcript: input.caseState ? `${input.caseState}\n\n${input.transcript}` : input.transcript,
      priorContributions: priors,
      allowSkip: true, // sem nada novo, o modelo devolve {"skip":true} e nada é exibido
    });
    if (contribution.skip) return { ...contribution, agentId: input.agentId };
    return {
      ...contribution,
      agentId: input.agentId, // a persona é decisão do board, não do modelo
      kbSources: context.map((c) => c.id), // proveniência → auditoria (1.5)
    };
  }
}
