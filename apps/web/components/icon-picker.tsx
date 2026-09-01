'use client';

import { useState } from 'react';
import { AGENT_ICON_KEYS, AgentIcon } from '@/lib/agent-icons';

/** Grade clicável dos ícones curados — grava a escolha num input hidden (`name`). */
export function IconPicker({
  name,
  defaultValue,
  emojiFallback,
}: {
  name: string;
  defaultValue?: string | null;
  emojiFallback: string;
}) {
  const [selected, setSelected] = useState<string | null>(defaultValue ?? null);

  return (
    <div>
      <input type="hidden" name={name} value={selected ?? ''} />
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
            className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-ink transition-colors ${
              selected === key ? 'bg-brand/15 text-brand ring-2 ring-brand' : 'hover:bg-surface-muted'
            }`}
          >
            <AgentIcon iconKey={key} emoji="" className="text-base" />
          </button>
        ))}
      </div>
    </div>
  );
}
