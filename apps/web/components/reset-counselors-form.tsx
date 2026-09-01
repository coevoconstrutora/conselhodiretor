'use client';

import { useActionState, useState } from 'react';
import { resetCompanyCounselorsAction, type ResetCounselorsState } from '@/lib/company-actions';

/** Reseta os conselheiros de uma empresa pro padrão do produto — remediação de vazamento entre empresas. */
export function ResetCompanyCounselorsForm({ companyId }: { companyId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ResetCounselorsState, FormData>(
    resetCompanyCounselorsAction,
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
        resetar conselheiros
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <span className="text-xs text-attn-critical">Apaga toda personalização — confirma?</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-attn-critical px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Resetando…' : 'Sim, resetar'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-muted underline">
        cancelar
      </button>
      {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
    </form>
  );
}
