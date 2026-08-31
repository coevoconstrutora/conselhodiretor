'use client';

import { useActionState, useState } from 'react';
import { renameCompanyAction, type RenameCompanyState } from '@/lib/company-actions';

export function RenameCompanyForm({ companyId, name }: { companyId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<RenameCompanyState, FormData>(
    renameCompanyAction,
    null,
  );

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-ink-muted underline hover:text-ink"
      >
        renomear
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input
        name="name"
        defaultValue={name}
        autoFocus
        className="rounded-[var(--radius)] border border-ink/15 bg-white px-2 py-1 text-xs text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Salvando…' : 'Salvar'}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink-muted underline">
        cancelar
      </button>
      {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
    </form>
  );
}
