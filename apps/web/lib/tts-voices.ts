import type { AgentId } from '@conselho/providers';

/**
 * Uma voz OpenAI TTS por conselheiro — 9 agentes, 9 vozes distintas. O
 * endpoint de fala usado aqui só aceita 9 destas: alloy, ash, coral, echo,
 * fable, nova, onyx, sage, shimmer ('ballad' e 'verse' existem no catálogo
 * geral da OpenAI, mas o endpoint rejeita com 400 — nunca usar aqui).
 * Escolha por "personalidade" da voz, não é ciência exata.
 */
export const AGENT_VOICE: Record<string, string> = {
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

/** As 9 vozes válidas neste endpoint — mesma lista do comentário acima. */
const VALID_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
] as const;

/**
 * Voz de um conselheiro — os 9 padrão têm entrada fixa em `AGENT_VOICE`;
 * um conselheiro CUSTOM (criado pelo dono) não está no mapa, então escolhe
 * uma voz de forma DETERMINÍSTICA a partir do próprio id (mesmo agente
 * sempre com a mesma voz, sem precisar cadastrar nada).
 */
export function resolveAgentVoice(agentId: AgentId): string {
  const known = AGENT_VOICE[agentId];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  return VALID_VOICES[hash % VALID_VOICES.length]!;
}
