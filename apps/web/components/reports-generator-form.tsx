'use client';

import { useActionState } from 'react';
import { generateReportsAction } from '@/lib/report-actions';
import { ACTION_ERROR_MESSAGES, type ActionResult } from '@/lib/action-result';

/**
 * Botão "Gerar relatórios do conselho": 1 relatório por conselheiro da
 * empresa (padrão + custom) + síntese do Presidente. Fluxo de alto risco
 * (N chamadas de LLM em série) ⇒ ActionResult com mensagens pt-BR
 * acionáveis; estado pending explícito (a geração leva ~1 min).
 */
export function ReportsGeneratorForm({
  meetingId,
  hasReports,
}: {
  meetingId: string;
  hasReports: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => generateReportsAction(meetingId),
    null,
  );

  return (
    <form action={formAction} className="text-right">
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending
          ? '⏳ Gerando relatórios…'
          : hasReports
            ? '🔄 Regenerar relatórios'
            : '📊 Gerar relatórios do conselho'}
      </button>
      {state && !state.ok ? (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-600">
          {ACTION_ERROR_MESSAGES[state.code]}
        </p>
      ) : null}
    </form>
  );
}
