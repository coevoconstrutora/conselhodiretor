'use client';

import { useActionState } from 'react';
import { saveCostSettingsAction } from '@/lib/system-settings-actions';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * Ajuste manual do limite de custo de IA por reunião (só ao vivo — os relatórios
 * finais ficam de fora) e da tabela de preços por modelo usada para medi-lo.
 */
export function CostSettingsForm({
  limitUsd,
  limitSource,
  pricesJson,
  pricesSource,
}: {
  limitUsd: number;
  limitSource: 'tela' | 'env' | 'padrão';
  pricesJson: string;
  pricesSource: 'tela' | 'padrão';
}) {
  const [state, formAction, pending] = useActionState(saveCostSettingsAction, null);

  return (
    <form action={formAction} className="card-premium mt-6 space-y-4 p-5">
      <div>
        <h2 className="font-display text-base font-semibold text-ink">Limite de custo por reunião</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Vale para a IA ao vivo (conselheiros, estado do caso, revisão do caso). Ao atingir o limite, o conselho ao
          vivo pausa naquela reunião. <strong>Os relatórios finais após a reunião não entram na conta nem são
          bloqueados.</strong>
        </p>
      </div>

      <label className="block max-w-xs">
        <span className="text-xs font-medium text-ink">Limite por reunião (US$)</span>
        <input
          id="meetingCostLimitUsd"
          name="meetingCostLimitUsd"
          type="text"
          inputMode="decimal"
          defaultValue={String(limitUsd)}
          className={`${inputCls} mt-1`}
          aria-describedby="limit-help"
        />
        <span id="limit-help" className="mt-1 block text-[11px] text-ink-muted">
          0 desativa a trava. Origem atual: {limitSource === 'tela' ? 'definido aqui' : limitSource === 'env' ? 'variável MEETING_COST_LIMIT_USD' : 'padrão do sistema (US$ 3,00)'}.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">Preços por modelo (US$ por 1 milhão de tokens)</span>
        <textarea
          id="modelPrices"
          name="modelPrices"
          rows={8}
          defaultValue={pricesJson}
          spellCheck={false}
          className={`${inputCls} mt-1 font-mono text-xs`}
          aria-describedby="prices-help"
        />
        <span id="prices-help" className="mt-1 block text-[11px] text-ink-muted">
          JSON: <code>{'{"modelo": {"input": 5, "cachedInput": 0.5, "output": 30}}'}</code>. A saída inclui os tokens de
          raciocínio. Modelo fora da tabela usa o preço do mais caro. Origem atual: {pricesSource === 'tela' ? 'definida aqui' : 'tabela padrão — confira em platform.openai.com/docs/pricing'}.
        </span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <div aria-live="polite">
          {state?.error ? (
            <p role="alert" className="text-xs font-medium text-red-600">
              ⚠ {state.error}
            </p>
          ) : null}
          {state?.ok ? <p className="text-xs font-medium text-success">✓ {state.ok}</p> : null}
        </div>
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Salvando…' : '💾 Salvar limites'}
        </button>
      </div>
    </form>
  );
}
