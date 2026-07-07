'use client';

import { useEffect, useState } from 'react';
import type { TranscriptSource } from './transcript-panel';

/**
 * Banner "transcrição instável" (Story 2.6 — frontend-spec §3.1): aparece no
 * topo da área principal quando a sessão (2.3) degrada; some quando o retry
 * recupera. Fonte única de estado = a sessão — consistente com o
 * `<TranscriptPanel>` (AC4). Discreto: a reunião NUNCA trava.
 */
export function TranscriptionBanner({ source }: { source: TranscriptSource }) {
  const [degraded, setDegraded] = useState(() => source.getSnapshot().status === 'degraded');

  useEffect(() => {
    const unsubscribe = source.subscribe(() =>
      setDegraded(source.getSnapshot().status === 'degraded'),
    );
    setDegraded(source.getSnapshot().status === 'degraded');
    return unsubscribe;
  }, [source]);

  if (!degraded) return null;

  return (
    <div
      role="status"
      data-testid="transcription-banner"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800"
    >
      ⚠️ Transcrição instável — tentando reconectar. A consulta segue normalmente.
    </div>
  );
}
