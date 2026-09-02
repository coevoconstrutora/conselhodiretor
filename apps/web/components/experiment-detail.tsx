'use client';

import { useActionState, useState } from 'react';
import { runExperimentAction, promoteExperimentAction, type ExperimentActionState } from '@/lib/experiment-actions';
import type { ExperimentStatus, ExperimentResultLabel } from '@conselho/meeting-report';

const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';
const secondaryButtonCls =
  'rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50';

const PROMOTABLE_RESULTS: ExperimentResultLabel[] = ['recommended', 'promising'];

/** "Rodar experimento" / "Aplicar em produção" (Seções 9/36) — ações do experimento, com confirmação explícita antes de tocar produção. */
export function ExperimentActions({
  experimentId,
  status,
  result,
}: {
  experimentId: string;
  status: ExperimentStatus;
  result: ExperimentResultLabel | null;
}) {
  const [runState, runAction, runPending] = useActionState<ExperimentActionState, FormData>(runExperimentAction, null);
  const [promoteState, promoteAction, promotePending] = useActionState<ExperimentActionState, FormData>(
    promoteExperimentAction,
    null,
  );
  const [confirmPromote, setConfirmPromote] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'draft' || status === 'failed' ? (
          <form action={runAction}>
            <input type="hidden" name="experimentId" value={experimentId} />
            <button type="submit" disabled={runPending} className={buttonCls}>
              {runPending ? 'Rodando… (pode levar alguns minutos)' : '▶ Rodar experimento'}
            </button>
          </form>
        ) : null}

        {status === 'completed' && result && PROMOTABLE_RESULTS.includes(result) ? (
          !confirmPromote ? (
            <button type="button" onClick={() => setConfirmPromote(true)} className={secondaryButtonCls}>
              Aplicar em produção
            </button>
          ) : (
            <form action={promoteAction} className="flex items-center gap-2">
              <input type="hidden" name="experimentId" value={experimentId} />
              <span className="text-xs text-attn-critical">Isto muda a configuração REAL do alvo. Confirma?</span>
              <button type="submit" disabled={promotePending} className={buttonCls}>
                {promotePending ? 'Aplicando…' : 'Confirmar'}
              </button>
              <button type="button" onClick={() => setConfirmPromote(false)} className={secondaryButtonCls}>
                Cancelar
              </button>
            </form>
          )
        ) : null}

        {status === 'promoted' ? (
          <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
            ✓ Aplicado em produção
          </span>
        ) : null}
      </div>
      {runState?.error ? <p className="text-xs font-medium text-attn-critical">⚠ {runState.error}</p> : null}
      {promoteState?.error ? <p className="text-xs font-medium text-attn-critical">⚠ {promoteState.error}</p> : null}
      {promoteState?.ok ? <p className="text-xs font-medium text-success">✓ {promoteState.ok}</p> : null}
    </div>
  );
}
