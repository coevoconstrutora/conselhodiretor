import type { AgentId } from '@conselho/providers';
import type { RiskPosture } from '@conselho/kb';

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

const RISK_DELIVERY_HINT: Record<RiskPosture, string> = {
  conservative: ' Tom mais cauteloso e ponderado, como quem pesa bem antes de falar.',
  moderate: ' Tom equilibrado, nem afobado nem hesitante.',
  aggressive: ' Tom mais direto e assertivo, sem rodeios.',
};

/**
 * Direção de fala (`instructions` do gpt-4o-mini-tts) — o que faz a voz soar
 * como UM CONSELHEIRO DE VERDADE numa reunião, não uma leitura de texto: ritmo
 * conversacional, pausas naturais, e um leve ajuste de tom pela postura de
 * risco cadastrada no perfil (quando houver). Sem isso, toda voz sai neutra.
 */
export function buildVoiceInstructions(
  displayName: string,
  riskPosture?: RiskPosture | null,
): string {
  const base =
    `Fale como ${displayName}, um conselheiro de verdade dando uma opinião ao vivo numa reunião de ` +
    `diretoria — nunca como quem lê um texto em voz alta. Ritmo conversacional, com pequenas pausas ` +
    `naturais entre ideias, e ênfase nas palavras que realmente importam.`;
  return base + (riskPosture ? RISK_DELIVERY_HINT[riskPosture] : '');
}
