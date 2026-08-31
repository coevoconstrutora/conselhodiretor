'use client';

import { useActionState } from 'react';
import { createCompanyAction, type CreateCompanyState } from '@/lib/company-actions';

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState<CreateCompanyState, FormData>(
    createCompanyAction,
    null,
  );

  return (
    <form action={formAction} className="card-premium flex items-end gap-3 p-5">
      <label className="block flex-1">
        <span className="text-xs font-semibold text-ink">Nome da nova empresa</span>
        <input
          name="name"
          required
          placeholder="ex.: Velkor"
          className="mt-1 w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Criando…' : '+ Criar empresa'}
      </button>
      {state?.error ? <p className="text-xs text-attn-critical">⚠ {state.error}</p> : null}
      {state?.ok ? <p className="text-xs text-success">✓ {state.ok}</p> : null}
    </form>
  );
}
