'use client';

import { useActionState, useState } from 'react';
import {
  promoteSuperAdminAction,
  demoteSuperAdminAction,
  type SuperAdminActionState,
  type SuperAdminCandidate,
} from '@/lib/super-admin-actions';

function PromoteForm({ candidate }: { candidate: SuperAdminCandidate }) {
  const [state, formAction, pending] = useActionState<SuperAdminActionState, FormData>(
    promoteSuperAdminAction,
    null,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={candidate.id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
      >
        {pending ? 'Promovendo…' : 'Promover a super-admin'}
      </button>
      {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
    </form>
  );
}

function DemoteForm({ candidate }: { candidate: SuperAdminCandidate }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<SuperAdminActionState, FormData>(
    demoteSuperAdminAction,
    null,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-ink-muted underline hover:text-attn-critical"
      >
        remover super-admin
      </button>
    );
  }
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={candidate.id} />
      <span className="text-xs text-attn-critical">Confirmar remoção?</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] bg-attn-critical px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Removendo…' : 'Remover'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-muted underline">
        cancelar
      </button>
      {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
    </form>
  );
}

/** Governança de super-admin (Etapa 11): promover/rebaixar pela UI, nunca por SQL direto. */
export function SuperAdminManager({ candidates }: { candidates: SuperAdminCandidate[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {candidates.map((c) => (
        <li key={c.id} className="card-premium flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">
              {c.displayName}
              {c.isSuperAdmin ? (
                <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                  super-admin
                </span>
              ) : null}
            </p>
            <p className="text-xs text-ink-muted">
              {c.email} · empresa "casa": {c.homeCompanyName}
            </p>
          </div>
          {c.isSuperAdmin ? <DemoteForm candidate={c} /> : <PromoteForm candidate={c} />}
        </li>
      ))}
    </ul>
  );
}
