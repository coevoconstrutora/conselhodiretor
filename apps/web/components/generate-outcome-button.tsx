'use client';

import { useActionState } from 'react';
import { generateMeetingOutcomeAction } from '@/lib/report-actions';
import { ACTION_ERROR_MESSAGES, type ActionResult } from '@/lib/action-result';

/**
 * Botão de fallback "Gerar decisões e ações" — aparece nas abas Decisões/Ações
 * quando estão vazias, pra tentar de novo (reextrai da síntese do Presidente
 * já salva, sem repetir relatórios). Aparece nas duas abas porque vêm da
 * MESMA extração — gerar por uma preenche a outra também.
 */
export function GenerateOutcomeButton({ meetingId }: { meetingId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => generateMeetingOutcomeAction(meetingId),
    null,
  );

  return (
    <form action={formAction} className="mt-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? '⏳ Gerando…' : '🔁 Gerar decisões e ações'}
      </button>
      {state && !state.ok ? (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-600">
          {state.detail ?? ACTION_ERROR_MESSAGES[state.code]}
        </p>
      ) : null}
      {state?.ok ? <p className="mt-2 text-xs text-emerald-700">Concluído — revise a aba.</p> : null}
    </form>
  );
}
