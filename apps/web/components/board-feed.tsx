'use client';

import { useBoardStore } from '@/lib/board-store';
import { useBoardStream } from '@/lib/use-board-stream';
import { ContributionCard } from './contribution-card';

/**
 * Feed do board (Story 3.3 / demo E3): conecta ao gateway e renderiza as
 * contribuições em ordem de chegada. Skeleton — controles/Modo Foco são E7.
 */
export function BoardFeed({
  meetingId,
  token,
  wsBaseUrl,
}: {
  meetingId: string;
  token: string;
  wsBaseUrl: string;
}) {
  useBoardStream(meetingId, { baseUrl: wsBaseUrl, token });
  const contributions = useBoardStore((s) => s.contributions);

  return (
    <section aria-label="Feed do conselho" className="space-y-3">
      <h3 className="font-display text-sm font-semibold text-ink">Feed do conselho</h3>
      {contributions.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
          Os conselheiros estão ouvindo… contribuições aparecem aqui quando houver algo
          clinicamente relevante.
        </p>
      ) : (
        contributions.map((item) => <ContributionCard key={item.id} item={item} />)
      )}
    </section>
  );
}
