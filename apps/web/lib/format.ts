/** Empresa é brasileira, servidor pode rodar em UTC (Fly.io) — toda data exibida ao
 * usuário usa ESTE fuso, nunca o do processo, senão horários saem 3h adiantados. */
const TIME_ZONE = 'America/Sao_Paulo';

export function formatDateTimeBR(date: Date): string {
  return date.toLocaleString('pt-BR', { timeZone: TIME_ZONE });
}

export function formatDateBR(date: Date): string {
  return date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
}

export function formatTimeBR(date: Date, opts?: Intl.DateTimeFormatOptions): string {
  return date.toLocaleTimeString('pt-BR', { timeZone: TIME_ZONE, ...opts });
}

/** "1h 12min" entre o início (confirmação da gravação) e o encerramento — null se ainda não encerrou. */
export function formatMeetingDuration(start: Date, end: Date | null): string | null {
  if (!end) return null;
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

/** "2min 05s" (ou só "45s" abaixo de 1min) — tempo real de fala de um participante. */
export function formatSpeakingDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}min ${seconds.toString().padStart(2, '0')}s`;
}
