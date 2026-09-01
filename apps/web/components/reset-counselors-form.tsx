'use client';

import { useActionState, useState } from 'react';
import { resetCompanyMeetingHistoryAction, type ResetHistoryState } from '@/lib/company-actions';

/** Apaga o histórico de reuniões de uma empresa (reuniões/transcrições/relatórios) — preserva os conselheiros. */
export function ResetCompanyHistoryForm({ companyId }: { companyId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ResetHistoryState, FormData>(
    resetCompanyMeetingHistoryAction,
    null,
  );

  if (state?.ok) {
    return <span className="text-xs font-medium text-success">✓ {state.ok}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-ink-muted underline hover:text-ink"
      >
        limpar histórico de reuniões
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <span className="text-xs text-attn-critical">Apaga reuniões/transcrições/relatórios — confirma?</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-attn-critical px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Apagando…' : 'Sim, apagar'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-muted underline">
        cancelar
      </button>
      {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
    </form>
  );
}
