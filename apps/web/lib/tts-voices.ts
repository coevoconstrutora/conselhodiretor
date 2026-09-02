import type { AgentId } from '@conselho/providers';
import type { RiskPosture } from '@conselho/kb';
import { VOICES } from './ai-config';

/**
 * Uma voz OpenAI TTS por conselheiro — 9 agentes, 9 vozes distintas
 * (fallback quando o conselheiro não tem `voice` individual configurada,
 * Etapa "IA por conselheiro"). O endpoint de fala usado aqui só aceita as
 * vozes de `VOICES` (ai-config.ts — 'ballad' e 'verse' existem no catálogo
 * geral da OpenAI, mas o endpoint rejeita com 400, por isso não entram
 * nessa lista). Escolha por "personalidade" da voz, não é ciência exata.
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

/**
 * Voz de um conselheiro — os 9 padrão têm entrada fixa em `AGENT_VOICE`;
 * um conselheiro CUSTOM (criado pelo dono) não está no mapa, então escolhe
 * uma voz de forma DETERMINÍSTICA a partir do próprio id (mesmo agente
 * sempre com a mesma voz, sem precisar cadastrar nada). Só o FALLBACK
 * quando o conselheiro não tem `voice` individual salva.
 */
export function resolveAgentVoice(agentId: AgentId): string {
  const known = AGENT_VOICE[agentId];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  return VOICES[hash % VOICES.length]!.value;
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
