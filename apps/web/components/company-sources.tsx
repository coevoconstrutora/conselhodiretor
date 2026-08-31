'use client';

import { useActionState } from 'react';
import type { CompanySourceSummary } from '@/lib/company-profile';
import {
  addCompanyTextSourceAction,
  addCompanyUrlSourceAction,
  addCompanyFileSourceAction,
  deleteCompanySourceAction,
  type CompanyProfileActionState,
} from '@/lib/company-profile-actions';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

const KIND_LABEL: Record<string, string> = { text: 'texto', url: 'link', file: 'arquivo' };

function Feedback({ state }: { state: CompanyProfileActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="mt-2 text-xs font-medium text-attn-critical">
        ⚠ {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="mt-2 text-xs font-medium text-success">
        ✓ {state.ok}
      </p>
    );
  return null;
}

export function CompanySourcesList({ sources }: { sources: CompanySourceSummary[] }) {
  if (sources.length === 0) {
    return (
      <p className="mt-3 rounded-[var(--radius)] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
        Nenhum documento ainda — anexe plano de negócios, apresentação institucional ou qualquer
        outro contexto que TODOS os conselheiros devem conhecer.
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-ink/10">
      {sources.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{s.title}</p>
            <p className="text-[11px] text-ink-muted">
              {KIND_LABEL[s.kind] ?? s.kind} · {Math.max(1, Math.round(s.chars / 1000))}k chars ·{' '}
              {s.createdAt.toLocaleDateString('pt-BR')}
              {s.ref && s.kind === 'url' ? (
                <>
                  {' · '}
                  <a href={s.ref} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                    abrir origem
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <form action={deleteCompanySourceAction}>
            <input type="hidden" name="sourceId" value={s.id} />
            <button
              type="submit"
              aria-label={`Remover documento ${s.title}`}
              className="rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-xs text-attn-critical transition-colors hover:bg-attn-bg"
            >
              🗑 Remover
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

export function AddCompanyTextForm() {
  const [state, formAction, pending] = useActionState(addCompanyTextSourceAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-xs font-semibold text-ink">Título do documento</span>
        <input name="title" placeholder='Ex.: "Plano de negócios 2026"' required className={inputCls} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-ink">Conteúdo</span>
        <textarea name="content" rows={6} required className={inputCls} />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Adicionando…' : '📄 Adicionar texto'}
        </button>
      </div>
    </form>
  );
}

export function AddCompanyUrlForm() {
  const [state, formAction, pending] = useActionState(addCompanyUrlSourceAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          URL (o sistema baixa a página e extrai o texto)
        </span>
        <input name="url" type="url" placeholder="https://exemplo.com/institucional" required className={inputCls} />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Importando… (até 20s)' : '🔗 Importar link'}
        </button>
      </div>
    </form>
  );
}

export function AddCompanyFileForm() {
  const [state, formAction, pending] = useActionState(addCompanyFileSourceAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          Arquivo .txt, .md ou .csv (máx. 2 MB) — para PDF/Word, copie o texto e use
          &ldquo;Adicionar texto&rdquo;
        </span>
        <input
          name="file"
          type="file"
          accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
          required
          className={`${inputCls} file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Enviando…' : '📎 Enviar arquivo'}
        </button>
      </div>
    </form>
  );
}
