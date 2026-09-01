'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import type { CompanyProfile } from '@conselho/kb';
import { saveCompanyAppearanceAction, type CompanyAppearanceState } from '@/lib/company-profile-actions';
import { THEME_PALETTES } from '@/lib/theme-palettes';

/** HSL triplo ("H S% L%") → string CSS pra pintar o swatch de preview. */
function hslSwatch(triplet: string): string {
  return `hsl(${triplet})`;
}

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
  const [palette, setPalette] = useState(profile.themePalette ?? '');
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
              <img
                src={logoPreview}
                alt="Logo da empresa"
                className="h-full w-full object-contain mix-blend-multiply"
              />
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

      <div>
        <span className="text-xs font-semibold text-ink">Cores do tema</span>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          Um conjunto coordenado de cores (botões, links, filetes) com 1 clique — como os temas do
          Office/PowerPoint.
        </p>
        <ul className="mt-2 divide-y divide-ink/10 overflow-hidden rounded-[var(--radius)] border border-ink/15 bg-white">
          <li>
            <button
              type="button"
              onClick={() => setPalette('')}
              aria-pressed={palette === ''}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors ${
                palette === '' ? 'bg-brand/10 font-semibold text-brand' : 'text-ink hover:bg-surface-muted'
              }`}
            >
              <span className="h-4 w-4 shrink-0 rounded-full border border-ink/15 bg-surface" />
              Padrão do produto (Navy)
            </button>
          </li>
          {THEME_PALETTES.filter((p) => p.key !== 'navy').map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => setPalette(p.key)}
                aria-pressed={palette === p.key}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors ${
                  palette === p.key ? 'bg-brand/10 font-semibold text-brand' : 'text-ink hover:bg-surface-muted'
                }`}
              >
                <span className="flex shrink-0 -space-x-1">
                  <span
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: hslSwatch(p.brand) }}
                  />
                  <span
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: hslSwatch(p.accentGold) }}
                  />
                </span>
                {p.label}
              </button>
            </li>
          ))}
        </ul>
        <input type="hidden" name="themePalette" value={palette} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Cor do texto (opcional, além do tema)</span>
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
          <span className="text-xs font-semibold text-ink">Cor dos títulos (opcional, além do tema)</span>
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
