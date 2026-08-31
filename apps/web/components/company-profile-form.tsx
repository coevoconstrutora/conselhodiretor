'use client';

import { useActionState, useState } from 'react';
import type { CompanyProfile } from '@conselho/kb';
import {
  saveCompanyProfileAction,
  lookupCnpjAction,
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

  // Controlados pra permitir autopreenchimento pela busca de CNPJ.
  const [cnpj, setCnpj] = useState(profile.cnpj ?? '');
  const [name, setName] = useState(profile.name ?? '');
  const [segment, setSegment] = useState(profile.segment ?? '');
  const [region, setRegion] = useState(profile.region ?? '');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function handleLookupCnpj() {
    setLooking(true);
    setLookupError(null);
    try {
      const result = await lookupCnpjAction(cnpj);
      if (!result.ok) {
        setLookupError(result.error);
        return;
      }
      setName(result.data.nomeFantasia || result.data.razaoSocial);
      if (result.data.segmento) setSegment(result.data.segmento);
      if (result.data.regiao) setRegion(result.data.regiao);
    } finally {
      setLooking(false);
    }
  }

  return (
    <form action={formAction} className="card-premium space-y-4 p-6">
      <label className="block">
        <span className="text-xs font-semibold text-ink">CNPJ</span>
        <div className="flex gap-2">
          <input
            name="cnpj"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0000-00"
            className={inputCls}
          />
          <button
            type="button"
            onClick={handleLookupCnpj}
            disabled={looking || !cnpj.trim()}
            className="shrink-0 rounded-[var(--radius)] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {looking ? 'Buscando…' : '🔎 Buscar CNPJ'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">
          Preenche nome, segmento e região automaticamente a partir da base pública da Receita —
          revise antes de salvar.
        </p>
        {lookupError ? <p className="mt-1 text-xs text-attn-critical">⚠ {lookupError}</p> : null}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Nome da empresa</span>
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
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
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            placeholder="ex.: incorporação residencial, médio padrão"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Região de atuação</span>
          <input
            name="region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
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
