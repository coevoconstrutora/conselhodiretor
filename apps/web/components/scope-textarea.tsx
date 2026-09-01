'use client';

import { useState } from 'react';

export const SCOPE_FIELD_MAX = 2000;

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** Textarea de escopo ("o que pode"/"o que não pode") com limite e contador visíveis. */
export function ScopeTextarea({
  name,
  label,
  defaultValue = '',
  required,
  placeholder,
  rows = 3,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const left = SCOPE_FIELD_MAX - value.length;
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink">{label}</span>
      <textarea
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, SCOPE_FIELD_MAX))}
        rows={rows}
        maxLength={SCOPE_FIELD_MAX}
        required={required}
        placeholder={placeholder}
        className={inputCls}
      />
      <span className={`mt-0.5 block text-right text-[11px] ${left < 100 ? 'text-attn-critical' : 'text-ink-muted'}`}>
        {left} / {SCOPE_FIELD_MAX} restantes
      </span>
    </label>
  );
}
