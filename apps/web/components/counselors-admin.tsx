'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import type { AgentId } from '@conselho/providers';
import { createCounselorAction, deleteCounselorAction, type CounselorActionState } from '@/lib/counselor-actions';
import { ScopeTextarea, BIO_MAX } from './scope-textarea';
import { IconPicker } from './icon-picker';
import { AgentIcon } from '@/lib/agent-icons';
import { getAgentEmoji } from '@/lib/agent-display';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

export interface CounselorSummary {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly scope: string;
  readonly isDefault: boolean;
  readonly iconKey: string | null;
}

export function CreateCounselorForm() {
  const [state, formAction, pending] = useActionState<CounselorActionState, FormData>(
    createCounselorAction,
    null,
  );

  return (
    <form action={formAction} className="card-premium space-y-3 p-5">
      <h3 className="font-display text-sm font-semibold text-ink">+ Novo conselheiro</h3>
      <p className="text-xs text-ink-muted">
        Cada empresa começa com os 9 conselheiros padrão. Aqui você adiciona quem mais precisar —
        ex.: um especialista em Sustentabilidade, RH, ou Facilities.
      </p>
      <label className="block">
        <span className="text-xs font-semibold text-ink">Nome</span>
        <input name="displayName" placeholder="ex.: Sustentabilidade e ESG" required className={inputCls} />
      </label>
      <div>
        <span className="text-xs font-semibold text-ink">Ícone</span>
        <div className="mt-1">
          <IconPicker name="iconKey" emojiFallback="🧑‍💼" />
        </div>
      </div>
      <ScopeTextarea
        name="scopeCan"
        label="O que pode opinar"
        rows={2}
        placeholder="ex.: certificações ambientais, compensação de carbono, eficiência energética de obra, relatórios ESG"
        required
      />
      <ScopeTextarea
        name="scopeCannot"
        label="O que não pode opinar (opcional)"
        rows={2}
        placeholder="ex.: decisões financeiras, questões jurídicas fora do escopo ambiental"
      />
      <ScopeTextarea
        name="bio"
        label="Formação, experiência e outras informações (opcional)"
        rows={2}
        maxChars={BIO_MAX}
        placeholder="ex.: 15 anos em sustentabilidade corporativa, certificação LEED, ex-consultor ESG"
      />
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          Palavras-chave que o fazem reagir na reunião (separadas por vírgula)
        </span>
        <input
          name="triggerKeywords"
          placeholder="ex.: sustentabilidade, carbono, esg, certificação ambiental"
          required
          className={inputCls}
        />
        <span className="mt-1 block text-[11px] text-ink-muted">
          Sem palavra-chave este conselheiro nunca vai falar — não há como curar um gatilho
          automático para um escopo desconhecido.
        </span>
      </label>
      <div className="flex items-center justify-between gap-3">
        {state?.error ? (
          <p role="alert" className="text-xs font-medium text-attn-critical">
            ⚠ {state.error}
          </p>
        ) : state?.ok ? (
          <p className="text-xs text-success">✓ {state.ok}</p>
        ) : (
          <span />
        )}
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Criando…' : 'Criar conselheiro'}
        </button>
      </div>
    </form>
  );
}

function CounselorRow({ counselor }: { counselor: CounselorSummary }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li className="card-premium flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <Link
          href={`/counselors/${counselor.agentId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:underline"
        >
          <AgentIcon iconKey={counselor.iconKey} emoji={getAgentEmoji(counselor.agentId)} />
          {counselor.displayName}
        </Link>
        {counselor.isDefault ? (
          <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
            padrão
          </span>
        ) : (
          <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
            custom
          </span>
        )}
        <p className="truncate text-xs text-ink-muted">{counselor.scope}</p>
      </div>
      {counselor.isDefault ? null : confirmDelete ? (
        <form action={deleteCounselorAction} className="flex shrink-0 items-center gap-2">
          <input type="hidden" name="agentId" value={counselor.agentId} />
          <span className="text-xs text-attn-critical">Confirmar remoção?</span>
          <button
            type="submit"
            className="rounded-[var(--radius)] bg-attn-critical px-2.5 py-1.5 text-xs font-semibold text-white"
          >
            Remover
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-ink-muted underline">
            cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="shrink-0 text-xs text-ink-muted underline hover:text-attn-critical"
        >
          remover
        </button>
      )}
    </li>
  );
}

export function CounselorsList({ counselors }: { counselors: CounselorSummary[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {counselors.map((c) => (
        <CounselorRow key={c.agentId} counselor={c} />
      ))}
    </ul>
  );
}
