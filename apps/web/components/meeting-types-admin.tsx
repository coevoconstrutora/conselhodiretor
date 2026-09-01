'use client';

import { useActionState, useState } from 'react';
import type { AgentId } from '@conselho/providers';
import {
  createMeetingTypeAction,
  updateMeetingTypeAction,
  deleteMeetingTypeAction,
  type MeetingTypeActionState,
  type MeetingTypeSummary,
} from '@/lib/meeting-type-actions';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

interface AgentOption {
  id: AgentId;
  displayName: string;
}

function AgentCheckboxes({ agentOptions, defaultSelected }: { agentOptions: AgentOption[]; defaultSelected?: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {agentOptions.map((a) => (
        <label key={a.id} className="flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            name="agentIds"
            value={a.id}
            defaultChecked={defaultSelected ? defaultSelected.includes(a.id) : true}
            className="rounded border-ink/25"
          />
          {a.displayName}
        </label>
      ))}
    </div>
  );
}

export function CreateMeetingTypeForm({ agentOptions }: { agentOptions: AgentOption[] }) {
  const [state, formAction, pending] = useActionState<MeetingTypeActionState, FormData>(
    createMeetingTypeAction,
    null,
  );

  return (
    <form action={formAction} className="card-premium space-y-3 p-5">
      <h3 className="font-display text-sm font-semibold text-ink">+ Novo tipo de reunião</h3>
      <label className="block">
        <span className="text-xs font-semibold text-ink">Nome</span>
        <input name="name" placeholder="ex.: Comitê de Engenharia" required className={inputCls} />
      </label>
      <div>
        <span className="text-xs font-semibold text-ink">Conselheiros participantes</span>
        <div className="mt-1.5">
          <AgentCheckboxes agentOptions={agentOptions} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        {state?.error ? (
          <p role="alert" className="text-xs font-medium text-attn-critical">
            ⚠ {state.error}
          </p>
        ) : state?.ok ? (
          <p className="text-xs text-success">✓ {state.ok}</p>
        ) : (
          <span />
        )}
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Criando…' : 'Criar tipo'}
        </button>
      </div>
    </form>
  );
}

function EditMeetingTypeForm({
  type,
  agentOptions,
  onCancel,
}: {
  type: MeetingTypeSummary;
  agentOptions: AgentOption[];
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<MeetingTypeActionState, FormData>(
    updateMeetingTypeAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={type.id} />
      <label className="block">
        <span className="text-xs font-semibold text-ink">Nome</span>
        <input name="name" defaultValue={type.name} required className={inputCls} />
      </label>
      <div>
        <span className="text-xs font-semibold text-ink">Conselheiros participantes</span>
        <div className="mt-1.5">
          <AgentCheckboxes agentOptions={agentOptions} defaultSelected={type.agentIds} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-ink-muted underline">
          cancelar
        </button>
        {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
      </div>
    </form>
  );
}

function MeetingTypeRow({ type, agentOptions }: { type: MeetingTypeSummary; agentOptions: AgentOption[] }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const names = agentOptions.filter((a) => type.agentIds.includes(a.id)).map((a) => a.displayName);

  if (editing) {
    return (
      <li className="card-premium p-4">
        <EditMeetingTypeForm type={type} agentOptions={agentOptions} onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="card-premium flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {type.name}
          {type.isDefault ? (
            <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
              padrão
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-ink-muted">{names.join(', ') || 'nenhum conselheiro'}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface-muted"
        >
          editar
        </button>
        {type.isDefault ? null : confirmDelete ? (
          <form action={deleteMeetingTypeAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={type.id} />
            <span className="text-xs text-attn-critical">Confirmar remoção?</span>
            <button
              type="submit"
              className="rounded-[var(--radius)] bg-attn-critical px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              Remover
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-ink-muted underline">
              cancelar
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-ink-muted underline hover:text-attn-critical"
          >
            remover
          </button>
        )}
      </div>
    </li>
  );
}

export function MeetingTypesList({ types, agentOptions }: { types: MeetingTypeSummary[]; agentOptions: AgentOption[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {types.map((t) => (
        <MeetingTypeRow key={t.id} type={t} agentOptions={agentOptions} />
      ))}
    </ul>
  );
}
