import type { AgentId } from '@conselho/providers';

/**
 * Uma voz OpenAI TTS por conselheiro — 9 agentes, 9 vozes distintas. O
 * endpoint de fala usado aqui só aceita 9 destas: alloy, ash, coral, echo,
 * fable, nova, onyx, sage, shimmer ('ballad' e 'verse' existem no catálogo
 * geral da OpenAI, mas o endpoint rejeita com 400 — nunca usar aqui).
 * Escolha por "personalidade" da voz, não é ciência exata.
 */
export const AGENT_VOICE: Record<AgentId, string> = {
  engenharia: 'onyx',
  vendas: 'nova',
  mercado: 'ash',
  arquitetura: 'sage',
  legal: 'echo',
  cs: 'coral',
  cfo: 'alloy',
  futurista: 'shimmer',
  presidente: 'fable',
};
