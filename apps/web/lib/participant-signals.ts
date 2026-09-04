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
  /** Tempo real de fala em ms (Etapa "Análise de fala dos presentes") — 0 se não medido ainda. */
  readonly speakingMs: number;
  /** Trocas abruptas de turno (proxy de interrupção, nunca sobreposição real de áudio). */
  readonly interruptionCount: number;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}min${seconds.toString().padStart(2, '0')}s`;
}

/**
 * Bloco de texto pronto para anexar ao contexto da síntese final do
 * Presidente ('' se não houver sinais). NUNCA rotula estado emocional —
 * só contagens/durações observáveis (Seção 21/22).
 */
export function formatParticipantSignalsBlock(signals: readonly ParticipantSignal[]): string {
  if (signals.length === 0) return '';
  const lines = signals.map((s) => {
    const share = s.speechShare !== null ? ` (${Math.round(s.speechShare * 100)}% da fala identificada)` : '';
    const time = s.speakingMs > 0 ? `, ${formatDuration(s.speakingMs)} de fala` : '';
    const interruptions = s.interruptionCount > 0 ? `, ${s.interruptionCount} troca(s) abrupta(s) de turno` : '';
    return `- ${s.name}: ${s.speakingTurns} intervenções${share}${time}${interruptions}`;
  });
  return (
    'SINAIS OBJETIVOS DE PARTICIPAÇÃO (use só como pista de contexto — NUNCA rotule estado ' +
    `emocional/psicológico a partir disto; "trocas abruptas de turno" é uma aproximação por ` +
    `proximidade temporal, não uma medição real de sobreposição de fala):\n${lines.join('\n')}`
  );
}
