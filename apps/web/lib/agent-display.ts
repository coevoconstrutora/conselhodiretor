/**
 * Exibição compartilhada de conselheiro (emoji, resumo curto do escopo) —
 * usada na home, na sala de reunião (faixa + "N conselheiros presentes") e
 * no perfil do conselheiro. Um só lugar para não divergir entre as telas.
 */

export const AGENT_EMOJI: Record<string, string> = {
  engenharia: '🏗️',
  vendas: '📣',
  mercado: '📊',
  arquitetura: '📐',
  legal: '⚖️',
  cs: '🤝',
  cfo: '💰',
  futurista: '🔭',
  presidente: '⭐',
};

const DEFAULT_EMOJI = '🧑‍💼';

/** Emoji curado para os 9 padrão; conselheiro custom sem entrada cai no genérico. */
export function getAgentEmoji(agentId: string): string {
  return AGENT_EMOJI[agentId] ?? DEFAULT_EMOJI;
}

/**
 * Resumo curto do escopo (o dono digita um parágrafo em "Escopo"; aqui vira
 * 1 frase curta pros cards/faixa). Corta na última palavra completa antes do
 * limite, nunca no meio de uma palavra.
 */
export function buildQuickBriefing(scope: string, maxChars = 140): string {
  const trimmed = scope.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const safeCut = lastSpace > maxChars * 0.4 ? cut.slice(0, lastSpace) : cut;
  return `${safeCut.trimEnd()}…`;
}

/**
 * `displayName` guarda "Nome — Área" (ex.: "CFO — Funding, Caixa e MCMV")
 * como um campo só; aqui vira {name, area} pros cards/faixa. Sem separador
 * (conselheiro custom com nome simples), `area` fica vazio.
 */
export function splitNameArea(displayName: string): { name: string; area: string } {
  const match = /^(.+?)\s+[—-]\s+(.+)$/.exec(displayName.trim());
  if (!match) return { name: displayName.trim(), area: '' };
  return { name: match[1]!.trim(), area: match[2]!.trim() };
}

export interface AgentDisplayInfo {
  readonly id: string;
  readonly name: string;
  readonly area: string;
  readonly emoji: string;
  readonly iconKey: string | null;
  readonly briefing: string;
}

/**
 * Roster ordenado pra UI: Presidente sempre por último (ele só sintetiza,
 * nunca é "mais um especialista"), resto na ordem do registry.
 */
export function buildAgentRoster(
  profiles: Record<string, { agentId: string; displayName: string; scope: string; iconKey?: string | null }>,
): AgentDisplayInfo[] {
  return Object.values(profiles)
    .sort((a, b) => (a.agentId === 'presidente' ? 1 : b.agentId === 'presidente' ? -1 : 0))
    .map((p) => {
      const { name, area } = splitNameArea(p.displayName);
      return {
        id: p.agentId,
        name,
        area,
        emoji: getAgentEmoji(p.agentId),
        iconKey: p.iconKey ?? null,
        briefing: buildQuickBriefing(p.scope),
      };
    });
}
