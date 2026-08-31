'use client';

import { useActionState } from 'react';
import type { CompanyProfile } from '@conselho/kb';
import {
  saveCompanyProfileAction,
  type CompanyProfileActionState,
} from '@/lib/company-profile-actions';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

export function CompanyProfileForm({ profile }: { profile: CompanyProfile }) {
  const [state, formAction, pending] = useActionState<CompanyProfileActionState, FormData>(
    saveCompanyProfileAction,
    null,
  );

  return (
    <form action={formAction} className="card-premium space-y-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Nome da empresa</span>
          <input name="name" defaultValue={profile.name} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Porte</span>
          <input
            name="size"
            defaultValue={profile.size}
            placeholder="ex.: pequena, média, ~50 funcionários, VGV anual ~R$30M"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Segmento</span>
          <input
            name="segment"
            defaultValue={profile.segment}
            placeholder="ex.: incorporação residencial, médio padrão"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Região de atuação</span>
          <input
            name="region"
            defaultValue={profile.region}
            placeholder="ex.: Grande São Paulo"
            className={inputCls}
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          Contexto adicional (qualquer outro dado fundamental para os conselheiros)
        </span>
        <textarea
          name="notes"
          defaultValue={profile.notes}
          rows={5}
          placeholder="ex.: histórico de VGV, número de empreendimentos entregues, posicionamento de marca, prioridades estratégicas do ano..."
          className={inputCls}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        {state?.error ? (
          <p role="alert" className="text-xs font-medium text-attn-critical">
            ⚠ {state.error}
          </p>
        ) : state?.ok ? (
          <p role="status" className="text-xs font-medium text-success">
            ✓ {state.ok}
          </p>
        ) : (
          <span />
        )}
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Salvando…' : '💾 Salvar perfil da empresa'}
        </button>
      </div>
    </form>
  );
}
