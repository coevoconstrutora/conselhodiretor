'use client';

import { useActionState, useState } from 'react';
import {
  createUserAction,
  updateUserRoleAction,
  deleteUserAction,
  type CreateUserState,
  type UserActionState,
  type UserSummary,
} from '@/lib/user-actions';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  convidado: 'Convidado (leitura)',
};

export function CreateUserForm({ knownDomains }: { knownDomains: string[] }) {
  const [state, formAction, pending] = useActionState<CreateUserState, FormData>(
    createUserAction,
    null,
  );
  const [email, setEmail] = useState('');
  const localPart = email.split('@')[0] ?? '';

  return (
    <form action={formAction} className="card-premium space-y-3 p-5">
      <h3 className="font-display text-sm font-semibold text-ink">+ Novo usuário</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Nome</span>
          <input name="displayName" required className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">E-mail</span>
          <input
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            list="known-email-domains"
            className={inputCls}
          />
          {/* datalist recalculado a cada tecla: sugere "usuario@dominio-conhecido"
              pros domínios já usados por outros usuários desta empresa. */}
          <datalist id="known-email-domains">
            {localPart &&
              knownDomains.map((domain) => (
                <option key={domain} value={`${localPart}@${domain}`} />
              ))}
          </datalist>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Papel</span>
          <select name="role" defaultValue="gestor" className={inputCls}>
            <option value="gestor">Gestor</option>
            <option value="convidado">Convidado (leitura)</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        {state?.error ? (
          <p role="alert" className="text-xs font-medium text-attn-critical">
            ⚠ {state.error}
          </p>
        ) : (
          <span />
        )}
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Criando…' : 'Criar usuário'}
        </button>
      </div>
      {state?.generatedPassword ? (
        <p className="rounded-[var(--radius)] bg-surface-muted px-3 py-2.5 text-xs text-ink">
          ✓ {state.ok} Senha gerada (mostrada só agora — copie e repasse):{' '}
          <strong className="font-mono-data">{state.generatedPassword}</strong>
        </p>
      ) : null}
    </form>
  );
}

function RoleForm({ user, disabled }: { user: UserSummary; disabled: boolean }) {
  const [state, formAction, pending] = useActionState<UserActionState, FormData>(
    updateUserRoleAction,
    null,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={user.id} />
      <select
        name="role"
        defaultValue={user.role}
        disabled={disabled || pending}
        className="rounded-[var(--radius)] border border-ink/15 bg-white px-2 py-1.5 text-xs text-ink disabled:opacity-50"
      >
        <option value="admin">Administrador</option>
        <option value="gestor">Gestor</option>
        <option value="convidado">Convidado</option>
      </select>
      <button
        type="submit"
        disabled={disabled || pending}
        className="rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
      >
        Salvar
      </button>
      {state?.error ? <span className="text-xs text-attn-critical">⚠ {state.error}</span> : null}
    </form>
  );
}

export function UsersTable({ users, currentUserId }: { users: UserSummary[]; currentUserId: string }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <ul className="mt-5 space-y-3">
      {users.map((u) => {
        const isSelf = u.id === currentUserId;
        return (
          <li key={u.id} className="card-premium flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {u.displayName} {isSelf ? <span className="text-xs text-ink-muted">(você)</span> : null}
              </p>
              <p className="text-xs text-ink-muted">
                {u.email} · {ROLE_LABEL[u.role] ?? u.role}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <RoleForm user={u} disabled={isSelf} />
              {isSelf ? null : confirmDeleteId === u.id ? (
                <form action={deleteUserAction} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <span className="text-xs text-attn-critical">Confirmar remoção?</span>
                  <button
                    type="submit"
                    className="rounded-[var(--radius)] bg-attn-critical px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    Remover
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-ink-muted underline"
                  >
                    cancelar
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(u.id)}
                  className="text-xs text-ink-muted underline hover:text-attn-critical"
                >
                  remover
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
