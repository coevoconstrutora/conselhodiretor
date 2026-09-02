/**
 * Lógica PURA de formatação dos "sinais objetivos de participação" (Etapa
 * "Participantes", Seção 25) — extraída de `meeting-speakers.ts` (que tem
 * `import 'server-only'` e por isso não pode ser importado direto em
 * teste; mesmo padrão de `voice-similarity.ts`/`voice-quality.ts`).
 */

export interface ParticipantSignal {
  readonly name: string;
  readonly speakingTurns: number;
  readonly speechShare: number | null;
}

/**
 * Bloco de texto pronto para anexar ao contexto da síntese final do
 * Presidente ('' se não houver sinais). NUNCA rotula estado emocional —
 * só contagens observáveis (Seção 21/22).
 */
export function formatParticipantSignalsBlock(signals: readonly ParticipantSignal[]): string {
  if (signals.length === 0) return '';
  const lines = signals.map(
    (s) => `- ${s.name}: ${s.speakingTurns} intervenções${s.speechShare !== null ? ` (${Math.round(s.speechShare * 100)}% da fala identificada)` : ''}`,
  );
  return (
    'SINAIS OBJETIVOS DE PARTICIPAÇÃO (use só como pista de contexto — NUNCA rotule estado ' +
    `emocional/psicológico a partir disto):\n${lines.join('\n')}`
  );
}
