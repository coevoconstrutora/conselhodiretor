'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentDisplayInfo } from '@/lib/agent-display';
import { AgentIcon } from '@/lib/agent-icons';

const STORAGE_KEY = 'conselho:conselheiros-view';

/** Alterna entre cards (visual, ocupa mais espaço) e lista compacta (escaneia rápido com muitos conselheiros). */
export function CounselorsGrid({ agents }: { agents: readonly AgentDisplayInfo[] }) {
  const [view, setView] = useState<'cards' | 'list'>('list');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'cards' || saved === 'list') setView(saved);
    } catch {
      // localStorage indisponível (aba privada etc.) — mantém o default
    }
  }, []);

  function changeView(next: 'cards' | 'list') {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ok ignorar — só perde a preferência entre sessões
    }
  }

  return (
    <div>
      <div className="mt-4 flex justify-end gap-1.5" role="group" aria-label="Modo de exibição">
        <button
          type="button"
          onClick={() => changeView('cards')}
          aria-pressed={view === 'cards'}
          className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs font-semibold transition-colors ${
            view === 'cards'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-ink/15 text-ink-muted hover:bg-surface-muted'
          }`}
        >
          ▦ Cards
        </button>
        <button
          type="button"
          onClick={() => changeView('list')}
          aria-pressed={view === 'list'}
          className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs font-semibold transition-colors ${
            view === 'list'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-ink/15 text-ink-muted hover:bg-surface-muted'
          }`}
        >
          ☰ Lista
        </button>
      </div>

      {view === 'cards' ? (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Link
                href={`/counselors/${agent.id}`}
                className="card-premium flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-md"
              >
                <AgentIcon iconKey={agent.iconKey} emoji={agent.emoji} className="text-2xl leading-none" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{agent.name}</span>
                  {agent.area ? (
                    <span className="block truncate text-xs font-medium text-brand/80">{agent.area}</span>
                  ) : null}
                  <span className="mt-1 line-clamp-3 block text-xs leading-snug text-ink-muted">
                    {agent.briefing}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 divide-y divide-ink/10 rounded-[var(--radius)] border border-ink/10 bg-surface">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Link
                href={`/counselors/${agent.id}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-muted"
              >
                <AgentIcon iconKey={agent.iconKey} emoji={agent.emoji} className="text-lg leading-none" />
                <span className="w-40 shrink-0 truncate text-sm font-semibold text-ink">{agent.name}</span>
                <span className="w-52 shrink-0 truncate text-xs font-medium text-brand/80">{agent.area}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{agent.briefing}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
