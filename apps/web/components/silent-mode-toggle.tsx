'use client';

import { useActionState, useEffect, useState } from 'react';
import { toggleSilentModeAction, type ToggleSilentModeState } from '@/lib/board-actions';

/**
 * Modo silencioso (Etapa "board silencioso"): o board grava a transcrição e
 * segue atualizando o caso, mas para de gerar contribuições/sínteses AO VIVO
 * — os conselheiros voltam a opinar só nos relatórios finais. Útil numa
 * reunião tumultuada, onde ninguém ouviria os áudios de opinião mesmo assim.
 * Poll simples (5s) pra refletir o estado real do board, inclusive se outra
 * pessoa (ou outra aba) já alternou.
 */
export function SilentModeToggle({ meetingId }: { meetingId: string }) {
  const [silent, setSilent] = useState(false);
  const [state, formAction, pending] = useActionState<ToggleSilentModeState, FormData>(
    toggleSilentModeAction,
    null,
  );

  useEffect(() => {
    if (typeof state?.silentMode === 'boolean') setSilent(state.silentMode);
  }, [state]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/silent-mode`);
        if (!res.ok) return;
        const data = (await res.json()) as { silentMode: boolean };
        if (!disposed) setSilent(data.silentMode);
      } catch {
        // poll falhou — tenta de novo no próximo tick, não é crítico
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [meetingId]);

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="meetingId" value={meetingId} />
      <input type="hidden" name="enabled" value={silent ? '0' : '1'} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={silent}
        title={
          silent
            ? 'O board só está gravando a transcrição — os conselheiros só opinam nos relatórios finais. Clique para voltar ao vivo.'
            : 'Silenciar o board: só grava a transcrição, os conselheiros só opinam nos relatórios finais (útil em reuniões tumultuadas).'
        }
        className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
          silent
            ? 'border-amber-300/40 bg-amber-400/10 text-amber-200'
            : 'border-white/25 text-white hover:bg-white/10'
        }`}
      >
        {pending ? '…' : silent ? '🤫 só grava' : '🎙️ ao vivo'}
      </button>
      {state?.error ? <span className="text-xs text-red-300">⚠ {state.error}</span> : null}
    </form>
  );
}
