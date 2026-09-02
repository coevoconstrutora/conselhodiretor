'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { startMeetingAction, type StartMeetingState } from '@/lib/meeting-actions';
import { formatDateBR } from '@/lib/format';

interface MeetingTypeOption {
  readonly id: string;
  readonly name: string;
}

interface PreviousMeetingPreviewOption {
  readonly meetingId: string;
  readonly title: string;
  readonly closedAt: string; // serializado do Server Component — vira Date aqui
  readonly decisionsCount: number;
  readonly pendingDecisionsCount: number;
  readonly actionItemsCount: number;
}

/**
 * Formulário de nova reunião: título + tipo + pauta/roteiro opcional (Etapa
 * "guia de reunião") + contexto da reunião anterior do MESMO tipo (Etapa
 * "Histórico de reuniões", Seção 19) — opt-in explícito, nunca marcado por
 * padrão (Seção 10: "the user must intentionally choose").
 */
export function NewMeetingForm({
  types,
  defaultTypeId,
  previousByType = {},
}: {
  types: readonly MeetingTypeOption[];
  defaultTypeId: string | undefined;
  previousByType?: Record<string, PreviousMeetingPreviewOption | null>;
}) {
  const [state, formAction, pending] = useActionState<StartMeetingState, FormData>(
    startMeetingAction,
    null,
  );
  const [selectedTypeId, setSelectedTypeId] = useState(defaultTypeId ?? types[0]?.id);
  const [usePrevious, setUsePrevious] = useState(false);
  const previous = selectedTypeId ? previousByType[selectedTypeId] : null;

  return (
    <form action={formAction} className="card-premium mt-8 space-y-4 p-6">
      <label className="block">
        <span className="text-sm font-medium text-ink">Título da reunião</span>
        <input
          name="title"
          required
          placeholder="Ex.: Diretoria — aprovação do terreno da zona norte"
          className="mt-1.5 w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Tipo de reunião</span>
        <select
          name="meetingTypeId"
          defaultValue={defaultTypeId}
          onChange={(e) => {
            setSelectedTypeId(e.target.value);
            setUsePrevious(false); // trocar de tipo nunca herda a escolha do tipo anterior
          }}
          className="mt-1.5 w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-ink-muted">
          Define quais conselheiros participam —{' '}
          <Link href="/meeting-types" className="underline hover:text-ink">
            gerenciar tipos
          </Link>
          .
        </span>
      </label>

      {previous ? (
        <div className="rounded-[var(--radius)] border border-ink/15 bg-surface-muted/60 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Contexto da reunião anterior
          </p>
          <p className="mt-1 text-sm text-ink">
            {previous.title} — {formatDateBR(new Date(previous.closedAt))}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {previous.decisionsCount} decisõe{previous.decisionsCount === 1 ? '' : 's'}
            {previous.pendingDecisionsCount > 0 ? ` (${previous.pendingDecisionsCount} pendente${previous.pendingDecisionsCount === 1 ? '' : 's'})` : ''}
            {' · '}
            {previous.actionItemsCount} ação{previous.actionItemsCount === 1 ? '' : 'ões'}
          </p>
          <label className="mt-2 flex items-start gap-2 text-xs font-medium text-ink">
            <input
              type="checkbox"
              checked={usePrevious}
              onChange={(e) => setUsePrevious(e.target.checked)}
              className="mt-0.5"
            />
            <span>Usar ata anterior como contexto</span>
          </label>
          <p className="mt-1 text-[11px] text-ink-muted">
            A ata anterior será usada apenas como contexto para identificar decisões pendentes, ações,
            riscos e assuntos que possam exigir acompanhamento. Ela não será copiada para a nova reunião.
          </p>
          {usePrevious ? (
            <input type="hidden" name="previousContextMeetingId" value={previous.meetingId} />
          ) : null}
        </div>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-ink">
          Pauta/roteiro <span className="font-normal text-ink-muted">(opcional)</span>
        </span>
        <input
          name="guidanceFile"
          type="file"
          accept=".txt,.md,.markdown,.csv,.pdf,.docx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-1.5 w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <span className="mt-1 block text-xs text-ink-muted">
          .txt, .md, .csv, .pdf ou .docx — vira contexto extra para os conselheiros (a sequência de
          assuntos a tratar). Cifrado em repouso, como o título.
        </span>
      </label>
      <p className="text-xs text-ink-muted">
        O título e a pauta são cifrados em repouso. A gravação só liga depois que você confirmar
        que os participantes estão de acordo.
      </p>
      {state?.error ? (
        <p className="text-xs font-medium text-attn-critical">⚠ {state.error}</p>
      ) : null}
      <div className="flex items-center justify-between pt-2">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink hover:underline">
          🏠 Home
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius)] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando…' : 'Criar e abrir a sala'}
        </button>
      </div>
    </form>
  );
}
