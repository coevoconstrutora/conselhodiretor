'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { runBoardAutoConfiguratorAction, type BoardConfiguratorState } from '@/lib/auto-configurator-actions';
import { SCORE_LABEL_TEXT, classifyScoreLabel } from '@/lib/auto-configurator-scoring';

const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';
const secondaryButtonCls =
  'rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50';

interface CounselorOption {
  readonly agentId: string;
  readonly displayName: string;
}

/**
 * "Auto Configurar Conselho" (Etapa "Auto Configurador", Seções 5-8) —
 * triagem do board inteiro: analisa os conselheiros selecionados e devolve
 * um resumo por conselheiro. A revisão/aprovação campo a campo continua
 * acontecendo na página individual de cada um (link "Revisar").
 */
export function BoardAutoConfigurator({ counselors }: { counselors: readonly CounselorOption[] }) {
  const [state, formAction, pending] = useActionState<BoardConfiguratorState, FormData>(
    runBoardAutoConfiguratorAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(counselors.map((c) => c.agentId)));

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(counselors.map((c) => c.agentId)) : new Set());
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonCls}>
        ✨ Auto Configurar Conselho
      </button>
    );
  }

  return (
    <div className="card-premium mt-4 space-y-4 p-5">
      <form action={formAction} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-ink">Auto Configurar Conselho</h3>
          <button type="button" onClick={() => setOpen(false)} className={secondaryButtonCls}>
            Fechar
          </button>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs">
            <button type="button" onClick={() => toggleAll(true)} className="text-brand hover:underline">
              Selecionar todos
            </button>
            <span className="text-ink-muted">·</span>
            <button type="button" onClick={() => toggleAll(false)} className="text-brand hover:underline">
              Desmarcar todos
            </button>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {counselors.map((c) => (
              <label key={c.agentId} className="flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  name="agentIds"
                  value={c.agentId}
                  checked={selected.has(c.agentId)}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.agentId);
                      else next.delete(c.agentId);
                      return next;
                    });
                  }}
                />
                {c.displayName}
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Profundidade da análise</span>
          <select name="depth" defaultValue="padrao" className="mt-1 rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink">
            <option value="rapida">Rápida — só contexto organizacional</option>
            <option value="padrao">Padrão — + conhecimento cadastrado</option>
            <option value="profunda">Profunda — + desempenho histórico</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Analisando… (pode levar um pouco)' : 'Analisar conselho'}
        </button>
      </form>

      {state?.error ? <p className="text-xs font-medium text-attn-critical">⚠ {state.error}</p> : null}

      {state?.results ? (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-ink/10">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-surface-muted/60 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">Conselheiro</th>
                <th className="px-3 py-2">Configuração</th>
                <th className="px-3 py-2">Observação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {state.results.map((r) => (
                <tr key={r.agentId}>
                  <td className="px-3 py-2 font-medium text-ink">{r.displayName}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {r.score.overall}/100 · {SCORE_LABEL_TEXT[classifyScoreLabel(r.score.overall)]}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.reasoning}</td>
                  <td className="px-3 py-2">
                    <Link href={`/counselors/${r.agentId}`} className="text-xs font-semibold text-brand hover:underline">
                      Revisar →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
