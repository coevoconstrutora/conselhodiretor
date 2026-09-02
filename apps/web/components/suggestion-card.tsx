'use client';

import { useState } from 'react';
import { DisclaimerNote } from './disclaimer-note';
import { useBoardStore, type BoardContributionItem } from '@/lib/board-store';
import { formatTimeBR } from '@/lib/format';
import { AgentIcon } from '@/lib/agent-icons';
import type { StripCounselor } from './counselor-strip';

/**
 * `<SuggestionCard>` (E7 — FR8/FR15/NFR3/NFR4, frontend-spec §6/§7).
 *
 * 4 tipos com hierarquia visual de SEGURANÇA (NFR4): ⚠️ domina em borda (4px),
 * fundo tingido, label e pulso 2x; 💡/🔍 têm destaque que DECAI em ~8s (NFR3 —
 * o card fica, o realce some); 📋 é neutro. Tipo nunca depende só de cor
 * (ícone + label uppercase — daltonismo, §6.1).
 */

const TYPE_CONFIG: Record<
  string,
  { icon: string; label: string; border: string; labelColor: string; decay: boolean }
> = {
  atencao: {
    icon: '⚠️',
    label: 'PONTO DE ATENÇÃO',
    border: 'border-l-4 border-l-attn bg-attn-bg',
    labelColor: 'text-attn-critical',
    decay: false,
  },
  sugestao: {
    icon: '💡',
    label: 'SUGESTÃO',
    border: 'border-l-4 border-l-suggest',
    labelColor: 'text-suggest',
    decay: true,
  },
  hipotese: {
    icon: '🔍',
    label: 'HIPÓTESE',
    border: 'border-l-4 border-l-hypothesis',
    labelColor: 'text-hypothesis',
    decay: true,
  },
  sintese: {
    icon: '📋',
    label: 'SÍNTESE DO PRESIDENTE',
    border: 'border-l-4 border-l-synthesis',
    labelColor: 'text-synthesis',
    decay: false,
  },
};

/**
 * Cor de destaque por PAPEL (não por empresa — é bandeira visual do cargo,
 * igual pra todo mundo). Nome/área/ícone de verdade vêm de `agents` (prop),
 * que já reflete a personalização por empresa (`agent_profile`) — nunca um
 * texto fixo aqui, senão a Velkor mostraria o nome que a Coevo configurou.
 */
const AGENT_ACCENT: Record<string, string> = {
  engenharia: 'text-agent-engenharia',
  vendas: 'text-agent-vendas',
  mercado: 'text-agent-mercado',
  arquitetura: 'text-agent-arquitetura',
  legal: 'text-agent-legal',
  cs: 'text-agent-cs',
  cfo: 'text-agent-cfo',
  futurista: 'text-agent-futurista',
  presidente: 'text-agent-presidente',
};
const DEFAULT_ACCENT = 'text-ink-muted'; // conselheiro custom sem cor curada

function timeLabel(at: number): string {
  return formatTimeBR(new Date(at), { hour: '2-digit', minute: '2-digit' });
}

export function SuggestionCard({
  item,
  agents,
}: {
  item: BoardContributionItem;
  agents: readonly StripCounselor[];
}) {
  const { contribution } = item;
  const config = TYPE_CONFIG[contribution.type] ?? TYPE_CONFIG.sugestao!;
  const counselor = agents.find((a) => a.id === contribution.agentId);
  const name = counselor?.name ?? contribution.agentId;
  const specialty = counselor?.area ?? '';
  const accent = AGENT_ACCENT[contribution.agentId] ?? DEFAULT_ACCENT;
  const critical = contribution.severity === 'critical';
  const consolidated = (item.agentIds?.length ?? 1) > 1;

  const pinned = useBoardStore((s) => s.pinned.has(item.id));
  const togglePin = useBoardStore((s) => s.togglePin);
  const dismiss = useBoardStore((s) => s.dismiss);
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      aria-label={`${config.label} de ${name}`}
      data-type={contribution.type}
      data-severity={contribution.severity}
      className={`board-entry rounded-[var(--radius)] border border-ink/10 bg-surface p-4 shadow-[0_1px_2px_hsl(var(--text)/0.04),0_6px_16px_hsl(var(--text)/0.04)] ${config.border} ${
        critical ? 'board-pulse' : config.decay ? 'board-decay' : ''
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentIcon
            iconKey={counselor?.iconKey}
            iconColor={counselor?.iconColor}
            emoji={counselor?.emoji ?? '🧑‍💼'}
            className="text-lg"
          />
          <div>
            <p className={`font-display text-[15px] leading-tight ${critical ? 'font-bold' : 'font-semibold'} text-ink`}>
              {name}
              {specialty ? <span className={`ml-1 text-xs font-medium ${accent}`}>· {specialty}</span> : null}
            </p>
            <p className={`text-[11px] font-bold uppercase tracking-wide ${config.labelColor}`}>
              <span aria-hidden="true">{config.icon} </span>
              {config.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-ink-muted">
          {pinned ? (
            <span className="rounded bg-attn-bg px-1.5 py-0.5 text-[10px] font-bold text-attn-critical">FIXADO</span>
          ) : null}
          <time>{timeLabel(item.at)}</time>
        </div>
      </header>

      {consolidated ? (
        <p className="mt-1 text-[11px] font-semibold text-ink-muted">
          🤝 Consolidado — {item.agentIds!.map((p) => agents.find((a) => a.id === p)?.name ?? p).join(' + ')}
        </p>
      ) : null}
      {item.divergent ? (
        <p className="mt-1 text-[11px] font-semibold text-hypothesis">
          ⚖️ Visões diferentes no board — a escolha é sua
        </p>
      ) : null}

      <p className="mt-2 text-[15px] leading-relaxed text-ink">
        {expanded || contribution.text.length <= 180
          ? contribution.text
          : `${contribution.text.slice(0, 180)}…`}
      </p>

      <footer className="mt-3 flex items-center justify-between border-t border-ink/8 pt-2">
        <div className="flex gap-1">
          {contribution.text.length > 180 ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="rounded-[var(--radius)] px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
            >
              {expanded ? 'recolher' : 'expandir'}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={pinned ? 'Desafixar' : 'Fixar'}
            aria-pressed={pinned}
            onClick={() => togglePin(item.id)}
            className="rounded-[var(--radius)] px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
          >
            📌
          </button>
          <button
            type="button"
            aria-label="Dispensar"
            onClick={() => dismiss(item.id)}
            className="rounded-[var(--radius)] px-2 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
          >
            ✓
          </button>
        </div>
        <DisclaimerNote variant="card" />
      </footer>
    </article>
  );
}
