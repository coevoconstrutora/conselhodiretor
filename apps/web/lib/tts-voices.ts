import type { AgentId } from '@conselho/providers';

/**
 * Uma voz OpenAI TTS por conselheiro — 9 agentes, 9 vozes distintas (o
 * catálogo tem 11: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage,
 * shimmer, verse). Escolha por "personalidade" da voz, não é ciência exata.
 */
export const AGENT_VOICE: Record<AgentId, string> = {
  engenharia: 'onyx',
  vendas: 'verse',
  mercado: 'ash',
  arquitetura: 'sage',
  legal: 'echo',
  cs: 'coral',
  cfo: 'ballad',
  futurista: 'shimmer',
  presidente: 'fable',
};
