'use client';

import { useEffect, useRef } from 'react';
import { useBoardStore } from './board-store';

/**
 * Telemetria de UI (E10 — R3/PRD §9): observa o store e reporta deltas de
 * Modo Foco/silenciar/dispensar/fixar via POST fire-and-forget. Só contadores
 * — nenhum conteúdo clínico sai do cliente por aqui.
 */
export function useUiTelemetry(meetingId: string): void {
  const focusMode = useBoardStore((s) => s.focusMode);
  const silencedCount = useBoardStore((s) => s.silenced.size);
  const dismissedCount = useBoardStore((s) => s.dismissed.size);
  const pinnedCount = useBoardStore((s) => s.pinned.size);

  const prev = useRef({ focusMode, silencedCount, dismissedCount, pinnedCount, first: true });

  useEffect(() => {
    const p = prev.current;
    const send = (kind: string) => {
      void fetch(`/api/meetings/${meetingId}/ui-telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
        keepalive: true,
      }).catch(() => {});
    };
    if (!p.first) {
      if (focusMode !== p.focusMode) send(focusMode ? 'focus-on' : 'focus-off');
      if (silencedCount > p.silencedCount) send('silence');
      if (silencedCount < p.silencedCount) send('unsilence');
      if (dismissedCount > p.dismissedCount) send('dismiss');
      if (dismissedCount < p.dismissedCount) send('undo-dismiss');
      if (pinnedCount > p.pinnedCount) send('pin');
    }
    prev.current = { focusMode, silencedCount, dismissedCount, pinnedCount, first: false };
  }, [meetingId, focusMode, silencedCount, dismissedCount, pinnedCount]);
}
