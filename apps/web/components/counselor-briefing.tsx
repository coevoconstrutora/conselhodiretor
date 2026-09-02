'use client';

import { useActionState } from 'react';
import type { AgentId } from '@conselho/providers';
import { generateCounselorBriefingAction, type BriefingActionState } from '@/lib/counselor-actions';

/**
 * Card acima do título do conselheiro: briefing curto (≤140 chars) gerado
 * por IA a partir do perfil INTEIRO (escopo + perfil profissional + critérios
 * + postura de risco) — substitui a truncagem crua do escopo (que carregava
 * o prefixo "PODE opinar sobre:" e cortava no meio da frase). Sob demanda:
 * só gera quando o dono clica.
 */
export function CounselorBriefingCard({
  agentId,
  briefing,
}: {
  agentId: AgentId;
  briefing: string | null;
}) {
  const [state, formAction, pending] = useActionState<BriefingActionState, FormData>(
    generateCounselorBriefingAction,
    null,
  );
  const current = state?.briefing ?? briefing;

  return (
    <section aria-label="Briefing do conselheiro" className="card-premium mt-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            ✨ Briefing rápido
          </h2>
          {current ? (
            <p className="mt-1 text-sm text-ink">{current}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">
              Nenhum ainda — gere um resumo curto a partir de tudo que está preenchido no perfil
              abaixo (escopo, formação, critérios de decisão, postura de risco).
            </p>
          )}
          {state?.error ? (
            <p className="mt-1 text-xs font-medium text-attn-critical">⚠ {state.error}</p>
          ) : null}
        </div>
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="agentId" value={agentId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {pending ? 'Gerando…' : current ? '🔄 Regerar' : '✨ Gerar briefing'}
          </button>
        </form>
      </div>
    </section>
  );
}
