'use client';

import { useState } from 'react';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

const OPTIONS = [
  { value: '', label: '— não definida —' },
  { value: 'conservative', label: 'Conservadora' },
  { value: 'moderate', label: 'Moderada' },
  { value: 'aggressive', label: 'Agressiva' },
];

/** Postura de risco (select) + texto opcional de contexto — como o conselheiro tende a decidir sob incerteza. */
export function RiskPostureField({
  defaultValue = '',
  defaultNotes = '',
}: {
  defaultValue?: string;
  defaultNotes?: string;
}) {
  const [posture, setPosture] = useState(defaultValue);
  return (
    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
      <label className="block">
        <span className="text-xs font-semibold text-ink">Postura de risco</span>
        <select
          name="riskPosture"
          value={posture}
          onChange={(e) => setPosture(e.target.value)}
          className={inputCls}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-ink">Contexto adicional (opcional)</span>
        <input
          name="riskPostureNotes"
          defaultValue={defaultNotes}
          disabled={!posture}
          placeholder="ex.: prioriza fluxo de caixa sobre crescimento acelerado"
          maxLength={300}
          className={`${inputCls} disabled:opacity-40`}
        />
      </label>
    </div>
  );
}
