import type { ILlmProvider } from '@conselho/providers';
import type { RiskPosture } from '@conselho/kb';

/**
 * Geração do briefing curto (Etapa "briefing do conselheiro") — separada de
 * kb-sources.ts (que é server-only) para ser testável por unidade, mesmo
 * padrão de text-extract.ts/voice-similarity.ts.
 */

/** Limite do briefing curto (cards/listas) — cabe numa linha sem quebrar o layout. */
export const BRIEFING_MAX = 140;

/** Rótulo PT-BR da postura de risco — mesmo texto usado no prompt (reasoner.ts), duplicado aqui de propósito (é só copy de UI/briefing, não regra de negócio). */
const RISK_POSTURE_LABEL: Record<RiskPosture, string> = {
  conservative: 'conservadora',
  moderate: 'moderada',
  aggressive: 'agressiva',
};

const BRIEFING_SYSTEM =
  'Você escreve briefings curtos para membros de um conselho consultivo de IA de uma incorporadora ' +
  `imobiliária, lidos por quem vai entrar numa reunião. A partir do perfil abaixo, escreva UM único ` +
  `briefing em português do Brasil, com NO MÁXIMO ${BRIEFING_MAX} caracteres, contando quem esse ` +
  'conselheiro é e o que ele cobre. Direto ao ponto, sem aspas, sem markdown, sem repetir o nome dele ' +
  'no começo da frase, sem ponto final se ficar apertado no limite de caracteres.';

export interface BriefingProfileInput {
  readonly displayName: string;
  readonly scopeCan: string;
  readonly scopeCannot: string;
  readonly professionalProfile: string | null;
  readonly decisionCriteria: string | null;
  readonly riskPosture: RiskPosture | null;
  readonly riskPostureNotes: string | null;
}

/** Monta o prompt de geração a partir do perfil INTEIRO (não só o escopo). */
export function buildBriefingPrompt(profile: BriefingProfileInput): string {
  const parts = [`Nome: ${profile.displayName}`, `Cobre: ${profile.scopeCan}`];
  if (profile.scopeCannot.trim()) parts.push(`NÃO cobre: ${profile.scopeCannot}`);
  if (profile.professionalProfile?.trim()) parts.push(`Perfil profissional: ${profile.professionalProfile}`);
  if (profile.decisionCriteria?.trim()) parts.push(`Prioriza ao avaliar: ${profile.decisionCriteria}`);
  if (profile.riskPosture) {
    const notes = profile.riskPostureNotes?.trim() ? ` (${profile.riskPostureNotes.trim()})` : '';
    parts.push(`Postura de risco: ${RISK_POSTURE_LABEL[profile.riskPosture]}${notes}`);
  }
  return parts.join('\n');
}

/**
 * Gera o briefing curto via IA a partir do perfil inteiro do conselheiro —
 * substitui a truncagem crua do campo de escopo (que carregava o prefixo
 * "PODE opinar sobre:" do prompt e cortava no meio da frase).
 */
export async function generateAgentBriefing(
  llm: ILlmProvider,
  profile: BriefingProfileInput,
): Promise<string> {
  if (typeof llm.completeText !== 'function') {
    throw new Error('O provedor de IA configurado não suporta geração de texto — configure uma chave de LLM real.');
  }
  const res = await llm.completeText({
    system: BRIEFING_SYSTEM,
    prompt: buildBriefingPrompt(profile),
    maxTokens: 120,
  });
  const text = res.text.trim().replace(/^["'“”]+|["'“”]+$/g, '');
  if (!text) throw new Error('A IA não devolveu texto — tente de novo.');
  return text.slice(0, BRIEFING_MAX);
}
