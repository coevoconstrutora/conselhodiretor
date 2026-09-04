'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { generateReportsAction } from '@/lib/report-actions';
import { ACTION_ERROR_MESSAGES, type ActionResult } from '@/lib/action-result';

const AUTO_POLL_MS = 8000;

/**
 * Botão "Gerar relatórios do conselho": 1 relatório por conselheiro da
 * empresa (padrão + custom) + síntese do Presidente. Fluxo de alto risco
 * (N chamadas de LLM em série) ⇒ ActionResult com mensagens pt-BR
 * acionáveis; estado pending explícito (a geração leva ~1 min).
 *
 * `autoPending`: `endMeetingAction` já disparou a geração automaticamente
 * em background (ver board-actions.ts) — aqui só refletimos isso na UI e
 * fazemos polling (`router.refresh()`) até os relatórios aparecerem. Se o
 * usuário mandar gerar manualmente enquanto isso, o polling cede lugar ao
 * estado normal do form.
 */
export function ReportsGeneratorForm({
  meetingId,
  hasReports,
  autoPending = false,
}: {
  meetingId: string;
  hasReports: boolean;
  /** true = fechou a reunião há pouco e a geração automática deve estar rolando. */
  autoPending?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => generateReportsAction(meetingId),
    null,
  );
  const router = useRouter();
  const showAutoStatus = autoPending && !hasReports && !state && !pending;

  useEffect(() => {
    if (!showAutoStatus) return;
    const interval = setInterval(() => router.refresh(), AUTO_POLL_MS);
    return () => clearInterval(interval);
  }, [showAutoStatus, router]);

  if (showAutoStatus) {
    return (
      <span className="flex items-center gap-2 text-xs text-ink-muted">
        <span
          aria-hidden
          className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand"
        />
        ⏳ Gerando relatórios automaticamente… (pode levar alguns minutos)
      </span>
    );
  }

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
          {state.detail ?? ACTION_ERROR_MESSAGES[state.code]}
        </p>
      ) : null}
    </form>
  );
}
