'use client';

import { useActionState } from 'react';
import { generatePresidentSynthesisAction } from '@/lib/report-actions';
import { ACTION_ERROR_MESSAGES, type ActionResult } from '@/lib/action-result';

/**
 * Botão de fallback "Gerar síntese do Presidente" — aparece quando os
 * relatórios dos conselheiros existem mas a síntese não foi gerada (ex.: a
 * geração automática pós-encerramento falhou no meio do caminho). Regenera
 * só a síntese, sem repetir os 8 relatórios já prontos.
 */
export function PresidentSynthesisButton({ meetingId }: { meetingId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => generatePresidentSynthesisAction(meetingId),
    null,
  );

  return (
    <form action={formAction} className="mt-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? '⏳ Gerando síntese…' : '📋 Gerar síntese do Presidente'}
      </button>
      {state && !state.ok ? (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-600">
          {state.detail ?? ACTION_ERROR_MESSAGES[state.code]}
        </p>
      ) : null}
    </form>
  );
}
