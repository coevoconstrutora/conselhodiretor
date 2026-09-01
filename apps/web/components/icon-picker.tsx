'use client';

import { useState } from 'react';
import { AGENT_ICON_KEYS, AgentIcon } from '@/lib/agent-icons';

/** Paleta curada — cobre a identidade visual do produto + algumas cores de apoio. */
const COLOR_SWATCHES = [
  '#1c3a6b', // brand (navy)
  '#2563eb', // azul
  '#0d9488', // teal
  '#16a34a', // verde
  '#ca8a04', // âmbar
  '#dc2626', // vermelho
  '#9333ea', // roxo
  '#db2777', // rosa
  '#475569', // cinza-ardósia
  '#0f172a', // quase-preto
];

/** Grade clicável dos ícones curados + cor opcional — grava em 2 inputs hidden (`name`/`colorName`). */
export function IconPicker({
  name,
  colorName,
  defaultValue,
  defaultColor,
  emojiFallback,
}: {
  name: string;
  colorName: string;
  defaultValue?: string | null;
  defaultColor?: string | null;
  emojiFallback: string;
}) {
  const [selected, setSelected] = useState<string | null>(defaultValue ?? null);
  const [color, setColor] = useState<string | null>(defaultColor ?? null);

  return (
    <div>
      <input type="hidden" name={name} value={selected ?? ''} />
      <input type="hidden" name={colorName} value={selected ? (color ?? '') : ''} />
      <div className="grid grid-cols-8 gap-1.5 rounded-[var(--radius)] border border-ink/15 bg-white p-2 sm:grid-cols-10">
        <button
          type="button"
          onClick={() => setSelected(null)}
          aria-pressed={selected === null}
          title="Usar emoji padrão"
          className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-lg transition-colors ${
            selected === null ? 'bg-brand/15 ring-2 ring-brand' : 'hover:bg-surface-muted'
          }`}
        >
          {emojiFallback}
        </button>
        {AGENT_ICON_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            aria-pressed={selected === key}
            title={key}
            className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius)] transition-colors ${
              selected === key ? 'bg-brand/15 ring-2 ring-brand' : 'text-ink hover:bg-surface-muted'
            }`}
          >
            <AgentIcon
              iconKey={key}
              iconColor={selected === key ? color : null}
              emoji=""
              className="text-base"
            />
          </button>
        ))}
      </div>

      {selected ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-ink">Cor:</span>
          <button
            type="button"
            onClick={() => setColor(null)}
            aria-pressed={color === null}
            title="Cor padrão"
            className={`h-6 w-6 rounded-full border border-ink/15 bg-white text-[10px] leading-6 text-ink-muted transition-transform ${
              color === null ? 'ring-2 ring-brand ring-offset-1' : ''
            }`}
          >
            ×
          </button>
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              title={c}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border border-black/10 transition-transform ${
                color === c ? 'ring-2 ring-brand ring-offset-1' : ''
              }`}
            />
          ))}
          <label className="ml-1 flex items-center gap-1 text-[11px] text-ink-muted">
            outra
            <input
              type="color"
              value={color ?? '#1c3a6b'}
              onChange={(e) => setColor(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border border-ink/15 p-0"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
