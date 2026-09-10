'use client';

import { useActionState } from 'react';
import { generateSecretaryMinutesAction } from '@/lib/report-actions';
import { ACTION_ERROR_MESSAGES, type ActionResult } from '@/lib/action-result';

/**
 * Botão de fallback "Gerar ata da Secretária" — aparece quando a síntese do
 * Presidente existe mas a ata não foi gerada (ex.: a geração automática
 * pós-síntese falhou). Regenera só a ata, sem repetir síntese nem relatórios.
 */
export function SecretaryMinutesButton({ meetingId }: { meetingId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => generateSecretaryMinutesAction(meetingId),
    null,
  );

  return (
    <form action={formAction} className="mt-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? '⏳ Gerando ata…' : '📝 Gerar ata da Secretária'}
      </button>
      {state && !state.ok ? (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-600">
          {state.detail ?? ACTION_ERROR_MESSAGES[state.code]}
        </p>
      ) : null}
    </form>
  );
}
