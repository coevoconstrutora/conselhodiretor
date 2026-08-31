/** "1h 12min" entre o início (confirmação da gravação) e o encerramento — null se ainda não encerrou. */
export function formatMeetingDuration(start: Date, end: Date | null): string | null {
  if (!end) return null;
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}
