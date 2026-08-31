'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { resetPasswordAction } from '@/lib/auth-actions';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, {});

  if (state.ok) {
    return (
      <div className="card-premium space-y-4 p-8 text-center">
        <p className="text-sm text-ink">✓ Senha redefinida.</p>
        <Link
          href="/login"
          className="inline-block rounded-[var(--radius)] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="card-premium space-y-5 p-8">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">Nova senha</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Escolha uma senha com pelo menos 8 caracteres.</p>
      </div>

      <input type="hidden" name="token" value={token} />

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">Nova senha</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !token}
        className="w-full rounded-[var(--radius)] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Salvando…' : 'Redefinir senha'}
      </button>
    </form>
  );
}
