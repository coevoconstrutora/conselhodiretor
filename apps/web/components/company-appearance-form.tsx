'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import type { CompanyProfile } from '@conselho/kb';
import { saveCompanyAppearanceAction, type CompanyAppearanceState } from '@/lib/company-profile-actions';

const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

/** Logo (upload + limite) e tema visual (cores/fundo) da empresa — separado do perfil de negócio. */
export function CompanyAppearanceForm({ profile }: { profile: CompanyProfile }) {
  const [state, formAction, pending] = useActionState<CompanyAppearanceState, FormData>(
    saveCompanyAppearanceAction,
    null,
  );
  const [logoPreview, setLogoPreview] = useState<string | null>(profile.logoDataUrl ?? null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [textColor, setTextColor] = useState(profile.themeTextColor ?? '');
  const [titleColor, setTitleColor] = useState(profile.themeTitleColor ?? '');
  const [background, setBackground] = useState<'grid' | 'plain'>(profile.themeBackground ?? 'grid');

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setRemoveLogo(false);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  return (
    <form action={formAction} className="card-premium space-y-5 p-6">
      <div>
        <span className="text-xs font-semibold text-ink">Logo da empresa</span>
        <div className="mt-2 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-dashed border-ink/20 bg-surface-muted">
            {logoPreview && !removeLogo ? (
              <img src={logoPreview} alt="Logo da empresa" className="h-full w-full object-contain" />
            ) : (
              <span className="text-[10px] text-ink-muted">sem logo</span>
            )}
          </div>
          <div className="space-y-1.5">
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={handleFileChange}
              className="block text-xs text-ink file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <p className="text-[11px] text-ink-muted">PNG, JPEG, WebP ou SVG — máx. 512 KB.</p>
            {logoPreview ? (
              <label className="flex items-center gap-1.5 text-[11px] text-ink">
                <input
                  type="checkbox"
                  name="removeLogo"
                  value="1"
                  checked={removeLogo}
                  onChange={(e) => {
                    setRemoveLogo(e.target.checked);
                    if (e.target.checked) setLogoPreview(null);
                  }}
                  className="rounded border-ink/25"
                />
                Remover logo atual
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Cor do texto</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={textColor || '#24303d'}
              onChange={(e) => setTextColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-ink/15 p-0"
            />
            <button
              type="button"
              onClick={() => setTextColor('')}
              className="text-[11px] text-ink-muted underline hover:text-ink"
            >
              usar padrão
            </button>
          </div>
          <input type="hidden" name="themeTextColor" value={textColor} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Cor dos títulos</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={titleColor || '#1c3a6b'}
              onChange={(e) => setTitleColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-ink/15 p-0"
            />
            <button
              type="button"
              onClick={() => setTitleColor('')}
              className="text-[11px] text-ink-muted underline hover:text-ink"
            >
              usar padrão
            </button>
          </div>
          <input type="hidden" name="themeTitleColor" value={titleColor} />
        </label>
      </div>

      <div>
        <span className="text-xs font-semibold text-ink">Fundo</span>
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            onClick={() => setBackground('grid')}
            aria-pressed={background === 'grid'}
            className={`rounded-[var(--radius)] border px-3 py-1.5 text-xs font-semibold transition-colors ${
              background === 'grid'
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-ink/15 text-ink-muted hover:bg-surface-muted'
            }`}
          >
            ▦ Grade (padrão)
          </button>
          <button
            type="button"
            onClick={() => setBackground('plain')}
            aria-pressed={background === 'plain'}
            className={`rounded-[var(--radius)] border px-3 py-1.5 text-xs font-semibold transition-colors ${
              background === 'plain'
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-ink/15 text-ink-muted hover:bg-surface-muted'
            }`}
          >
            ▢ Plano
          </button>
        </div>
        <input type="hidden" name="themeBackground" value={background} />
      </div>

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
          {pending ? 'Salvando…' : '💾 Salvar aparência'}
        </button>
      </div>
    </form>
  );
}
