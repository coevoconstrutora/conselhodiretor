'use client';

import { useState } from 'react';
import { DisclaimerNote } from './disclaimer-note';
import { useBoardStore, type BoardContributionItem } from '@/lib/board-store';
import { formatTimeBR } from '@/lib/format';

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

const PERSONA: Record<string, { name: string; specialty: string; accent: string; emoji: string }> = {
  engenharia: { name: 'Engenharia', specialty: 'Lean Construction', accent: 'text-agent-engenharia', emoji: '🏗️' },
  vendas: { name: 'Vendas', specialty: 'Vendas & Marketing', accent: 'text-agent-vendas', emoji: '📣' },
  mercado: { name: 'Mercado', specialty: 'Inteligência & Produto', accent: 'text-agent-mercado', emoji: '📊' },
  arquitetura: { name: 'Arquitetura', specialty: 'Arquitetura & Urbanismo', accent: 'text-agent-arquitetura', emoji: '📐' },
  legal: { name: 'Legal', specialty: 'Legal & Compliance', accent: 'text-agent-legal', emoji: '⚖️' },
  cs: { name: 'CS', specialty: 'Customer Success', accent: 'text-agent-cs', emoji: '🤝' },
  cfo: { name: 'CFO', specialty: 'Funding, Caixa & MCMV', accent: 'text-agent-cfo', emoji: '💰' },
  futurista: { name: 'Futurista', specialty: 'Tendências', accent: 'text-agent-futurista', emoji: '🔭' },
  presidente: { name: 'Presidente', specialty: 'Síntese do Conselho', accent: 'text-agent-presidente', emoji: '⭐' },
};

function timeLabel(at: number): string {
  return formatTimeBR(new Date(at), { hour: '2-digit', minute: '2-digit' });
}

export function SuggestionCard({ item }: { item: BoardContributionItem }) {
  const { contribution } = item;
  const config = TYPE_CONFIG[contribution.type] ?? TYPE_CONFIG.sugestao!;
  const persona = PERSONA[contribution.agentId] ?? PERSONA.presidente!;
  const critical = contribution.severity === 'critical';
  const consolidated = (item.agentIds?.length ?? 1) > 1;

  const pinned = useBoardStore((s) => s.pinned.has(item.id));
  const togglePin = useBoardStore((s) => s.togglePin);
  const dismiss = useBoardStore((s) => s.dismiss);
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      aria-label={`${config.label} de ${persona.name}`}
      data-type={contribution.type}
      data-severity={contribution.severity}
      className={`board-entry rounded-[var(--radius)] border border-ink/10 bg-surface p-4 shadow-[0_1px_2px_hsl(var(--text)/0.04),0_6px_16px_hsl(var(--text)/0.04)] ${config.border} ${
        critical ? 'board-pulse' : config.decay ? 'board-decay' : ''
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">{persona.emoji}</span>
          <div>
            <p className={`font-display text-[15px] leading-tight ${critical ? 'font-bold' : 'font-semibold'} text-ink`}>
              {persona.name}
              <span className={`ml-1 text-xs font-medium ${persona.accent}`}>· {persona.specialty}</span>
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
          🤝 Consolidado — {item.agentIds!.map((p) => PERSONA[p]?.name ?? p).join(' + ')}
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
