'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { endMeetingAction } from '@/lib/board-actions';
import { ACTION_ERROR_MESSAGES } from '@/lib/action-result';

/**
 * Encerra a reunião (para STT/board ao vivo ou simulado + trava novos
 * inícios). Ação de risco — confirmação em 2 cliques, sem modal.
 */
export function EndMeetingButton({ meetingId }: { meetingId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleEnd = () => {
    startTransition(async () => {
      const result = await endMeetingAction(meetingId);
      if (!result.ok) {
        setError(result.detail ?? ACTION_ERROR_MESSAGES[result.code]);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  };

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-red-300">Encerrar de vez?</span>
        <button
          type="button"
          onClick={handleEnd}
          disabled={pending}
          className="rounded-[var(--radius)] bg-red-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Encerrando…' : 'Sim, encerrar'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-white/60 underline hover:text-white"
        >
          cancelar
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-[var(--radius)] border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10"
      >
        ⏹ Encerrar reunião
      </button>
      {error ? <span className="text-[11px] text-red-300">⚠ {error}</span> : null}
    </span>
  );
}
