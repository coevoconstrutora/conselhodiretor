import { DisclaimerNote } from './disclaimer-note';
import type { BoardContributionItem } from '@/lib/board-store';

/**
 * `<ContributionCard>` mínimo (Story 3.3 — frontend-spec §6): persona, tipo,
 * texto e o disclaimer FR19 (Atom da 1.7 — REUSE). Os 4 tipos completos,
 * controles e decaimento são E7.
 */

const PERSONA_LABEL: Record<string, string> = {
  engenharia: 'Engenharia · Lean Construction',
  vendas: 'Vendas · Marketing',
  mercado: 'Mercado · Inteligência & Produto',
  arquitetura: 'Arquitetura · Urbanismo',
  legal: 'Legal · Compliance',
  cs: 'Customer Success · Pós-venda',
  cfo: 'CFO · Funding, Caixa & MCMV',
  futurista: 'Futurista · Tendências',
  presidente: 'Presidente · Síntese do Conselho',
};

const TYPE_LABEL: Record<string, string> = {
  atencao: '⚠️ Atenção',
  sugestao: '💡 Sugestão',
  hipotese: '🔍 Hipótese',
  sintese: '📋 Síntese',
};

export function ContributionCard({ item }: { item: BoardContributionItem }) {
  const { contribution } = item;
  const critical = contribution.severity === 'critical';
  return (
    <article
      aria-label={`Contribuição de ${PERSONA_LABEL[contribution.agentId] ?? contribution.agentId}`}
      data-severity={contribution.severity}
      className={`rounded-[var(--radius)] border p-4 ${critical ? 'border-attn/40 bg-attn-bg' : 'border-ink/10 bg-surface'}`}
    >
      <header className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">
          {PERSONA_LABEL[contribution.agentId] ?? contribution.agentId}
        </span>
        <span className="text-xs text-ink-muted">{TYPE_LABEL[contribution.type] ?? contribution.type}</span>
      </header>
      <p className="mt-2 text-sm text-ink/90">{contribution.text}</p>
      <footer className="mt-3 border-t border-ink/10 pt-2">
        <DisclaimerNote variant="card" />
      </footer>
    </article>
  );
}
