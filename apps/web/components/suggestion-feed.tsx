'use client';

import { useEffect, useState } from 'react';
import { useBoardStore, feedOrder } from '@/lib/board-store';
import { SuggestionCard } from './suggestion-card';

/**
 * `<SuggestionFeed>` (E7 — FR9, frontend-spec §9): feed cronológico INVERSO
 * com ⚠️/📌 fixos no topo, em DUAS regiões ARIA-live segmentadas por
 * severidade: `assertive` para críticos, `polite` para o resto. Dispensar tem
 * undo de 5s (FR15).
 */
export function SuggestionFeed() {
  const contributions = useBoardStore((s) => s.contributions);
  const pinned = useBoardStore((s) => s.pinned);
  const dismissed = useBoardStore((s) => s.dismissed);
  const lastDismissed = useBoardStore((s) => s.lastDismissed);
  const undoDismiss = useBoardStore((s) => s.undoDismiss);
  const focusMode = useBoardStore((s) => s.focusMode);
  const heldByFocus = useBoardStore((s) => s.heldByFocus);

  const { critical, regular } = feedOrder(contributions, pinned, dismissed);

  // undo do dispensar expira em 5s (FR15)
  const [undoVisible, setUndoVisible] = useState(false);
  useEffect(() => {
    if (!lastDismissed) return;
    setUndoVisible(true);
    const timer = setTimeout(() => setUndoVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [lastDismissed]);

  return (
    <div className="flex max-h-[560px] min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-white/50">
        Feed de sugestões
      </h2>

      {focusMode ? (
        <div
          data-testid="focus-banner"
          className="rounded-[var(--radius)] border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70"
        >
          🔇 Modo Foco ativo — só pontos de atenção aparecem.
          {heldByFocus > 0 ? ` ${heldByFocus} sugestão(ões) aguardando.` : ''}
        </div>
      ) : null}

      {/* ⚠️ críticos + 📌 fixos no topo — leitor de tela é interrompido (assertive) */}
      <div role="region" aria-label="Pontos de atenção" aria-live="assertive" className="space-y-3">
        {critical.map((item) => (
          <SuggestionCard key={item.id} item={item} />
        ))}
      </div>

      {/* demais — anunciados sem interromper (polite) */}
      <div role="region" aria-label="Sugestões do board" aria-live="polite" className="space-y-3">
        {regular.map((item) => (
          <SuggestionCard key={item.id} item={item} />
        ))}
      </div>

      {critical.length === 0 && regular.length === 0 && !focusMode ? (
        <p className="rounded-[var(--radius)] border border-dashed border-white/20 p-4 text-sm text-white/60">
          Os conselheiros estão ouvindo… nada urgente agora.
        </p>
      ) : null}

      {undoVisible && lastDismissed ? (
        <div className="sticky bottom-0 flex items-center justify-between rounded-[var(--radius)] bg-white px-3 py-2 text-xs font-medium text-ink shadow-lg">
          Sugestão dispensada.
          <button
            type="button"
            onClick={() => {
              undoDismiss();
              setUndoVisible(false);
            }}
            className="font-bold underline"
          >
            Desfazer
          </button>
        </div>
      ) : null}
    </div>
  );
}
