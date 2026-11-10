'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MeetingTypeTag } from './meeting-tags';

/** Item da lista, já serializável e com os rótulos de data/estado prontos (formatados no servidor). */
export interface MeetingListItem {
  id: string;
  title: string;
  /** ISO — só para filtrar por período. */
  createdAtIso: string;
  dateLabel: string;
  /** 'live' = gravação confirmada e não encerrada; 'pending' = aguardando confirmação; 'closed'. */
  state: 'live' | 'pending' | 'closed';
  stateLabel: string;
  durationLabel: string | null;
  creatorId: string;
  creatorName: string;
  confidential: boolean;
  typeName: string | null;
  attendees: string[];
  participantCount: number | null;
  sharedCount: number;
}

const STATE_FILTERS = [
  { value: 'all', label: 'Todas as situações' },
  { value: 'live', label: '🟢 Em andamento' },
  { value: 'pending', label: '🔒 Aguardando gravação' },
  { value: 'closed', label: 'Encerradas' },
] as const;

const ACCESS_FILTERS = [
  { value: 'all', label: 'Todos os acessos' },
  { value: 'confidential', label: '🔐 Confidenciais' },
  { value: 'open', label: 'Abertas à empresa' },
  { value: 'shared', label: '👥 Compartilhadas' },
] as const;

/** Máximo de reuniões exibidas de uma vez — as mais recentes; refine os filtros para achar as demais. */
const MAX_VISIBLE = 20;

const fieldCls =
  'rounded-[var(--radius)] border border-ink/15 bg-white px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Lista de reuniões com tags, criador, presentes e filtros (tudo no cliente — poucas dezenas de itens). */
export function MeetingsBrowser({
  meetings,
  viewerId,
  defaultFrom,
}: {
  meetings: MeetingListItem[];
  viewerId: string;
  /** Início do período padrão (AAAA-MM-DD) — hoje menos 30 dias, calculado no servidor. */
  defaultFrom: string;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [state, setState] = useState<(typeof STATE_FILTERS)[number]['value']>('all');
  const [creator, setCreator] = useState('all');
  const [access, setAccess] = useState<(typeof ACCESS_FILTERS)[number]['value']>('all');
  // Sempre abre filtrando os últimos 30 dias (e "Limpar filtros" volta a isso).
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState('');

  const typeOptions = useMemo(
    () => [...new Set(meetings.map((m) => m.typeName).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b)),
    [meetings],
  );
  const creatorOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of meetings) byId.set(m.creatorId, m.creatorName);
    return [...byId.entries()]
      .filter(([id]) => id !== viewerId)
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [meetings, viewerId]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return meetings.filter((m) => {
      if (q) {
        const haystack = normalize([m.title, m.creatorName, m.typeName ?? '', ...m.attendees].join(' '));
        if (!haystack.includes(q)) return false;
      }
      if (type !== 'all' && m.typeName !== type) return false;
      if (state !== 'all' && m.state !== state) return false;
      if (creator === 'mine' && m.creatorId !== viewerId) return false;
      if (creator !== 'all' && creator !== 'mine' && m.creatorId !== creator) return false;
      if (access === 'confidential' && !m.confidential) return false;
      if (access === 'open' && m.confidential) return false;
      if (access === 'shared' && m.sharedCount === 0) return false;
      const created = new Date(m.createdAtIso).getTime();
      if (fromMs !== null && created < fromMs) return false;
      if (toMs !== null && created > toMs) return false;
      return true;
    });
  }, [meetings, query, type, state, creator, access, from, to, viewerId]);

  const visible = filtered.slice(0, MAX_VISIBLE); // já vem da mais recente para a mais antiga
  const hasFilter =
    query !== '' ||
    type !== 'all' ||
    state !== 'all' ||
    creator !== 'all' ||
    access !== 'all' ||
    from !== defaultFrom ||
    to !== '';
  function clear() {
    setQuery('');
    setType('all');
    setState('all');
    setCreator('all');
    setAccess('all');
    setFrom(defaultFrom);
    setTo('');
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="card-premium space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, criador, presente ou tipo…"
            aria-label="Buscar reuniões"
            className={`${fieldCls} min-w-[16rem] flex-1`}
          />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de reunião" className={fieldCls}>
            <option value="all">Todos os tipos</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={state}
            onChange={(e) => setState(e.target.value as typeof state)}
            aria-label="Situação"
            className={fieldCls}
          >
            {STATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={creator} onChange={(e) => setCreator(e.target.value)} aria-label="Criador" className={fieldCls}>
            <option value="all">Todos os criadores</option>
            <option value="mine">Criadas por mim</option>
            {creatorOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as typeof access)}
            aria-label="Acesso"
            className={fieldCls}
          >
            {ACCESS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            de
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldCls} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            até
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldCls} />
          </label>
          {hasFilter ? (
            <button type="button" onClick={clear} className="text-xs font-semibold text-brand hover:underline">
              Limpar filtros
            </button>
          ) : null}
          <span className="ml-auto text-xs text-ink-muted" aria-live="polite">
            {filtered.length > MAX_VISIBLE
              ? `Mostrando as ${MAX_VISIBLE} mais recentes de ${filtered.length}`
              : `${filtered.length} reunião(ões)`}
            {from === defaultFrom && to === '' ? ' · últimos 30 dias' : ''}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="card-premium p-8 text-center text-sm text-ink-muted">
          Nenhuma reunião com esses filtros
          {from === defaultFrom ? ' nos últimos 30 dias — para ver reuniões mais antigas, altere a data "de".' : '.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((m) => (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="card-premium flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-md"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{m.title}</p>
                    {m.typeName ? <MeetingTypeTag name={m.typeName} /> : null}
                    {m.confidential ? (
                      <span className="rounded-full bg-attn-critical/10 px-2.5 py-0.5 text-xs font-semibold text-attn-critical">
                        🔐 Confidencial
                      </span>
                    ) : null}
                    {m.sharedCount > 0 ? (
                      <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                        👥 Compartilhada · {m.sharedCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {m.dateLabel} · {m.stateLabel}
                    {m.durationLabel ? ` · ⏱ ${m.durationLabel}` : ''}
                    {' · '}
                    Criada por {m.creatorId === viewerId ? 'você' : m.creatorName}
                  </p>
                  {m.attendees.length > 0 ? (
                    <p className="truncate text-xs text-ink-muted" title={m.attendees.join(', ')}>
                      👥 Presentes: {m.attendees.slice(0, 4).join(', ')}
                      {m.attendees.length > 4 ? ` +${m.attendees.length - 4}` : ''}
                    </p>
                  ) : m.participantCount ? (
                    <p className="text-xs text-ink-muted">👥 {m.participantCount} presentes</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm text-ink-muted">abrir →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
