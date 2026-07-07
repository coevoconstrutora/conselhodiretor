'use client';

import { useActionState } from 'react';
import { loginAction } from '@/lib/auth-actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, {});

  return (
    <main className="surface-deep-gradient flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* marca acima do card — serif + eyebrow dourado + filete UNIC */}
        <div className="mb-8 text-center">
          <div className="gold-hairline mx-auto mb-5 w-24" />
          <h1 className="font-display text-5xl font-medium tracking-tight text-white">
            Conselho
          </h1>
          <p className="brand-eyebrow mt-3 text-white/70">CONSELHO DE ESPECIALISTAS DE IA</p>
          <div className="gold-hairline mx-auto mt-5 w-24" />
        </div>

        <form action={action} className="card-premium space-y-5 p-8">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Acesso do empresário</h2>
            <p className="mt-0.5 text-xs text-ink-muted">A IA assiste, você decide.</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Senha</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
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
            disabled={pending}
            className="w-full rounded-[var(--radius)] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="rounded-[var(--radius)] bg-surface-muted px-3 py-2 text-center text-xs text-ink-muted">
            Demo: <strong>demo@conselho.test</strong> / <strong>conselho123</strong>
          </p>
        </form>
      </div>
    </main>
  );
}
