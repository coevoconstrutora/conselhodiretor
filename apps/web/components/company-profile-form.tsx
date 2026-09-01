'use client';

import { useActionState, useState, type KeyboardEvent } from 'react';
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
  const [regions, setRegions] = useState<string[]>([...(profile.region ?? [])]);
  const [regionInput, setRegionInput] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cnaeInfo, setCnaeInfo] = useState<{ principal: string | null; secundarios: readonly string[] } | null>(
    null,
  );

  function addRegion(raw: string) {
    const city = raw.trim();
    if (!city) return;
    setRegions((prev) => (prev.includes(city) ? prev : [...prev, city]));
    setRegionInput('');
  }

  function handleRegionKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addRegion(regionInput);
    } else if (e.key === 'Backspace' && !regionInput && regions.length > 0) {
      setRegions((prev) => prev.slice(0, -1));
    }
  }

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
      // adiciona a cidade da sede à lista (nunca substitui — a empresa pode
      // já ter cadastrado outras cidades onde atua além da matriz).
      if (result.data.regiao) addRegion(result.data.regiao);
      setCnaeInfo({ principal: result.data.cnaePrincipal, secundarios: result.data.cnaesSecundarios });
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
          Preenche nome, segmento e cidade da sede automaticamente a partir da base pública da
          Receita — revise antes de salvar.
        </p>
        {lookupError ? <p className="mt-1 text-xs text-attn-critical">⚠ {lookupError}</p> : null}
        {cnaeInfo ? (
          <div className="mt-2 rounded-[var(--radius)] border border-ink/10 bg-surface-muted p-2.5 text-[11px] text-ink-muted">
            {cnaeInfo.principal ? (
              <p>
                <span className="font-semibold text-ink">CNAE principal:</span> {cnaeInfo.principal}
              </p>
            ) : null}
            {cnaeInfo.secundarios.length > 0 ? (
              <>
                <p className="mt-1 font-semibold text-ink">
                  CNAEs secundários ({cnaeInfo.secundarios.length}):
                </p>
                <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                  {cnaeInfo.secundarios.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
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
          <span className="text-xs font-semibold text-ink">Cidades onde atua</span>
          <div className={`${inputCls} flex flex-wrap items-center gap-1.5`}>
            {regions.map((city) => (
              <span
                key={city}
                className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand"
              >
                {city}
                <button
                  type="button"
                  aria-label={`Remover ${city}`}
                  onClick={() => setRegions((prev) => prev.filter((c) => c !== city))}
                  className="text-brand/70 hover:text-brand"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              onKeyDown={handleRegionKeyDown}
              onBlur={() => addRegion(regionInput)}
              placeholder={regions.length === 0 ? 'ex.: Taubaté — Enter para adicionar' : 'adicionar cidade…'}
              className="min-w-[8rem] flex-1 border-0 p-0 text-sm outline-none focus:ring-0"
            />
          </div>
          {regions.map((city) => (
            <input key={city} type="hidden" name="region" value={city} />
          ))}
          <p className="mt-1 text-[11px] text-ink-muted">
            Uma cidade por vez — Enter, vírgula ou clicar fora adiciona.
          </p>
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
