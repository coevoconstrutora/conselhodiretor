'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { REASONING_MODELS, REASONING_EFFORTS } from '@/lib/ai-config';
import { createExperimentAction, type ExperimentActionState } from '@/lib/experiment-actions';
import type { AiExperiment } from '@conselho/meeting-report';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

const RESULT_LABEL: Record<string, { label: string; className: string }> = {
  recommended: { label: 'Recomendado', className: 'bg-success/10 text-success' },
  promising: { label: 'Promissor', className: 'bg-brand/10 text-brand' },
  inconclusive: { label: 'Inconclusivo', className: 'bg-ink/10 text-ink-muted' },
  not_recommended: { label: 'Não recomendado', className: 'bg-attn-bg text-attn-critical' },
  harmful: { label: 'Prejudicial', className: 'bg-attn-critical/10 text-attn-critical' },
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  running: 'Rodando…',
  completed: 'Concluído',
  failed: 'Falhou',
  promoted: 'Aplicado em produção',
};

export function CreateExperimentForm({ counselors }: { counselors: readonly { agentId: string; displayName: string }[] }) {
  const [state, formAction, pending] = useActionState<ExperimentActionState, FormData>(createExperimentAction, null);
  const [targetType, setTargetType] = useState<'counselor' | 'president_synthesis'>('counselor');

  return (
    <form action={formAction} className="card-premium space-y-3 p-5">
      <h3 className="font-display text-sm font-semibold text-ink">+ Novo experimento</h3>
      <p className="text-xs text-ink-muted">
        Testa um modelo/raciocínio CANDIDATO contra o relatório oficial já salvo (baseline) de até 8
        reuniões encerradas recentes — nunca altera a reunião histórica nem a produção até você
        clicar em &ldquo;Aplicar em produção&rdquo;.
      </p>
      <label className="block">
        <span className="text-xs font-semibold text-ink">Nome do experimento</span>
        <input name="name" required minLength={3} placeholder="Ex.: CFO — Luna no lugar de Terra" className={inputCls} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-ink">Objetivo (opcional)</span>
        <input name="objective" placeholder="Ex.: Reduzir custo sem perder qualidade" className={inputCls} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Alvo</span>
          <select
            name="targetType"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as typeof targetType)}
            className={inputCls}
          >
            <option value="counselor">Um conselheiro</option>
            <option value="president_synthesis">Síntese do Presidente</option>
          </select>
        </label>
        {targetType === 'counselor' ? (
          <label className="block">
            <span className="text-xs font-semibold text-ink">Conselheiro</span>
            <select name="targetAgentId" className={inputCls}>
              {counselors.map((c) => (
                <option key={c.agentId} value={c.agentId}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Modelo candidato</span>
          <select name="candidateModel" className={inputCls}>
            {REASONING_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Raciocínio candidato</span>
          <select name="candidateReasoningEffort" className={inputCls}>
            {REASONING_EFFORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        {state?.error ? <span className="text-xs font-medium text-attn-critical">⚠ {state.error}</span> : null}
        {state?.ok ? (
          <span className="text-xs font-medium text-success">
            ✓ {state.ok}{' '}
            {state.experimentId ? (
              <Link href={`/improvements/experiments/${state.experimentId}`} className="underline">
                Ver experimento
              </Link>
            ) : null}
          </span>
        ) : null}
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Criando…' : '+ Criar experimento'}
        </button>
      </div>
    </form>
  );
}

export function ExperimentsList({ experiments }: { experiments: readonly AiExperiment[] }) {
  if (experiments.length === 0) {
    return <p className="mt-4 text-sm text-ink-muted">Nenhum experimento ainda.</p>;
  }
  return (
    <ul className="mt-4 space-y-2">
      {experiments.map((exp) => (
        <li key={exp.id} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-ink/10 bg-surface p-3">
          <div className="min-w-0">
            <Link href={`/improvements/experiments/${exp.id}`} className="text-sm font-semibold text-ink hover:underline">
              {exp.name}
            </Link>
            <p className="text-[11px] text-ink-muted">
              {exp.candidateModel} / {exp.candidateReasoningEffort} · {STATUS_LABEL[exp.status] ?? exp.status}
            </p>
          </div>
          {exp.result ? (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${RESULT_LABEL[exp.result]?.className ?? ''}`}>
              {RESULT_LABEL[exp.result]?.label ?? exp.result}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export { RESULT_LABEL, STATUS_LABEL };
