'use client';

import { useActionState } from 'react';
import {
  createParticipantAction,
  updateParticipantAction,
  setParticipantStatusAction,
  type ParticipantActionState,
} from '@/lib/participant-actions';
import type { Participant } from '@/lib/participants';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

export function CreateParticipantForm() {
  const [state, formAction, pending] = useActionState<ParticipantActionState, FormData>(
    createParticipantAction,
    null,
  );

  return (
    <form action={formAction} className="card-premium space-y-3 p-5">
      <h3 className="font-display text-sm font-semibold text-ink">+ Novo participante</h3>
      <p className="text-xs text-ink-muted">
        Uma pessoa real que participa de reuniões — não precisa ter conta no sistema.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Nome</span>
          <input name="name" required minLength={2} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">E-mail</span>
          <input name="email" type="email" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Cargo</span>
          <input name="jobTitle" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Área / Departamento</span>
          <input name="department" className={inputCls} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-ink">Empresa (se for de fora)</span>
          <input name="companyName" className={inputCls} />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        {state?.error ? <span className="text-xs font-medium text-attn-critical">⚠ {state.error}</span> : null}
        {state?.ok ? <span className="text-xs font-medium text-success">✓ {state.ok}</span> : null}
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Criando…' : '+ Criar participante'}
        </button>
      </div>
    </form>
  );
}

/** Edição de dados + ativar/desativar (Seção 2/4) — nunca exclusão física. */
export function ParticipantProfileForm({ participant }: { participant: Participant }) {
  const [state, formAction, pending] = useActionState<ParticipantActionState, FormData>(
    updateParticipantAction,
    null,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="participantId" value={participant.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink">Nome</span>
            <input name="name" defaultValue={participant.name} required minLength={2} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">E-mail</span>
            <input name="email" type="email" defaultValue={participant.email ?? ''} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">Cargo</span>
            <input name="jobTitle" defaultValue={participant.jobTitle ?? ''} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">Área / Departamento</span>
            <input name="department" defaultValue={participant.department ?? ''} className={inputCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-ink">Empresa (se for de fora)</span>
            <input name="companyName" defaultValue={participant.companyName ?? ''} className={inputCls} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          {state?.error ? <span className="text-xs font-medium text-attn-critical">⚠ {state.error}</span> : null}
          {state?.ok ? <span className="text-xs font-medium text-success">✓ {state.ok}</span> : null}
          <button type="submit" disabled={pending} className={buttonCls}>
            {pending ? 'Salvando…' : '💾 Salvar'}
          </button>
        </div>
      </form>

      <form action={setParticipantStatusAction} className="flex items-center gap-2">
        <input type="hidden" name="participantId" value={participant.id} />
        <input type="hidden" name="status" value={participant.status === 'active' ? 'inactive' : 'active'} />
        <button
          type="submit"
          className="rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          {participant.status === 'active' ? '⏸ Desativar participante' : '▶ Reativar participante'}
        </button>
      </form>
    </div>
  );
}
