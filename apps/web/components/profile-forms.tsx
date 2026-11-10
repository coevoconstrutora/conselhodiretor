'use client';

import { useActionState, useRef } from 'react';
import {
  updateProfileAction,
  changePasswordAction,
  enableOwnParticipantAction,
  type ProfileActionState,
} from '@/lib/profile-actions';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-surface-muted disabled:text-ink-muted';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

function Feedback({ state }: { state: ProfileActionState }) {
  if (state?.error) {
    return (
      <span role="alert" className="text-xs font-medium text-attn-critical">
        ⚠ {state.error}
      </span>
    );
  }
  if (state?.ok) return <span className="text-xs font-medium text-success">✓ {state.ok}</span>;
  return <span />;
}

export function ProfileForm({
  email,
  displayName,
  jobTitle,
  department,
}: {
  email: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
}) {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(updateProfileAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Nome</span>
          <input name="displayName" defaultValue={displayName} required minLength={2} maxLength={120} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">E-mail (login)</span>
          <input value={email} disabled readOnly className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Cargo</span>
          <input name="jobTitle" defaultValue={jobTitle ?? ''} maxLength={160} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Área / Departamento</span>
          <input name="department" defaultValue={department ?? ''} maxLength={160} className={inputCls} />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Salvando…' : 'Salvar dados'}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    async (prev, formData) => {
      const result = await changePasswordAction(prev, formData);
      if (result?.ok) formRef.current?.reset();
      return result;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-xs font-semibold text-ink">Senha atual</span>
        <input name="currentPassword" type="password" autoComplete="current-password" required className={inputCls} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Nova senha</span>
          <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Confirmar nova senha</span>
          <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
        </label>
      </div>
      <p className="text-xs text-ink-muted">
        Mínimo de 8 caracteres. Ao trocar, você continua conectado aqui e os outros dispositivos são desconectados.
        A senha vale para todas as empresas a que você tem acesso.
      </p>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Alterando…' : 'Alterar senha'}
        </button>
      </div>
    </form>
  );
}

/** Mostrado quando a conta ainda não tem participante nesta empresa — cria/vincula e libera o cadastro de voz. */
export function EnableOwnParticipant() {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    (prev) => enableOwnParticipantAction(prev),
    null,
  );
  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-ink-muted">
        Para cadastrar sua voz, o sistema precisa de um perfil de participante ligado à sua conta nesta empresa.
      </p>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Preparando…' : 'Habilitar minha voz'}
        </button>
      </div>
    </form>
  );
}
