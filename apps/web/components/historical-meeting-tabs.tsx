'use client';

import { useState, type ReactNode } from 'react';

const TABS = [
  { key: 'transcricao', label: 'Transcrição' },
  { key: 'contribuicoes', label: 'Contribuições' },
  { key: 'decisoes', label: 'Decisões' },
  { key: 'acoes', label: 'Ações' },
  { key: 'ata', label: 'Ata' },
  { key: 'sintese', label: 'Síntese' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * Estrutura em abas da reunião ENCERRADA (Etapa "Histórico de reuniões",
 * Seção 5) — cada aba recebe seu conteúdo JÁ RENDERIZADO pelo Server
 * Component (dados vêm do banco, não desta camada); este componente só
 * troca qual painel fica visível. Reunião AO VIVO continua com o layout
 * plano de sempre (sem tabs) — não passa por aqui.
 */
export function HistoricalMeetingTabs({
  transcricao,
  contribuicoes,
  decisoes,
  acoes,
  ata,
  sintese,
}: Record<TabKey, ReactNode>) {
  const [active, setActive] = useState<TabKey>('transcricao');
  const panels: Record<TabKey, ReactNode> = { transcricao, contribuicoes, decisoes, acoes, ata, sintese };

  return (
    <section aria-label="Histórico da reunião" className="card-premium mt-6 p-6">
      <div role="tablist" aria-label="Seções do histórico" className="flex flex-wrap gap-1 border-b border-ink/10 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`rounded-[var(--radius)] px-3 py-1.5 text-sm font-semibold transition-colors ${
              active === tab.key ? 'bg-brand text-white' : 'text-ink-muted hover:bg-surface-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-4">
        {panels[active]}
      </div>
    </section>
  );
}
