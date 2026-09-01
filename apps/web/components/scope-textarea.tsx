'use client';

import { useState } from 'react';

export const SCOPE_FIELD_MAX = 2000;
export const PROFESSIONAL_PROFILE_MAX = 2000;
export const DECISION_CRITERIA_MAX = 2000;

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** Textarea com limite e contador visíveis — escopo (2000, default) ou bio (1000). */
export function ScopeTextarea({
  name,
  label,
  defaultValue = '',
  required,
  placeholder,
  rows = 3,
  maxChars = SCOPE_FIELD_MAX,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  maxChars?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const left = maxChars - value.length;
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink">{label}</span>
      <textarea
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, maxChars))}
        rows={rows}
        maxLength={maxChars}
        required={required}
        placeholder={placeholder}
        className={inputCls}
      />
      <span className={`mt-0.5 block text-right text-[11px] ${left < 100 ? 'text-attn-critical' : 'text-ink-muted'}`}>
        {left} / {maxChars} restantes
      </span>
    </label>
  );
}
