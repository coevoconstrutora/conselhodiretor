/**
 * Watchdog da reunião ao vivo (A3): decide se o médico deve ser avisado de
 * que está "ao vivo" mas NENHUM transcript (nem parcial) chegou — a falha
 * silenciosa do incidente de produção. Puro para ser testável sem timers.
 */
export const TRANSCRIPT_WATCHDOG_MS = 10_000;

export function isTranscriptSilent(
  liveSinceMs: number,
  lastTranscriptAtMs: number | null,
  nowMs: number,
  thresholdMs: number = TRANSCRIPT_WATCHDOG_MS,
): boolean {
  const nothingSinceLive = lastTranscriptAtMs === null || lastTranscriptAtMs < liveSinceMs;
  return nothingSinceLive && nowMs - liveSinceMs >= thresholdMs;
}
