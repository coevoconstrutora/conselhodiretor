import type { MeetingContributionRecord, MeetingDecisionRecord, MeetingActionItemRecord } from '@conselho/meeting-report';
import type { AgentProfile } from '@conselho/kb';
import type { AgentId } from '@conselho/providers';
import { formatDateBR, formatTimeBR } from '@/lib/format';

/**
 * Conteúdo das abas "Contribuições" / "Decisões" / "Ações" da reunião
 * ENCERRADA (Etapa "Histórico de reuniões", Seção 5) — Server Components
 * puros (dados já vêm prontos do banco), sem interatividade própria.
 */

const TYPE_ICON: Record<string, string> = {
  atencao: '⚠️',
  sugestao: '💡',
  hipotese: '🔍',
  sintese: '📋',
};

const DECISION_STATUS_LABEL: Record<string, string> = {
  decidido: '✅ Decidido',
  recomendado: '💡 Recomendado',
  pendente: '⏳ Pendente',
  cancelado: '✕ Cancelado',
};

export function ContributionsPanel({
  contributions,
  profiles,
}: {
  contributions: readonly MeetingContributionRecord[];
  profiles: Record<AgentId, AgentProfile>;
}) {
  if (contributions.length === 0) {
    return <p className="text-sm text-ink-muted">Nenhuma contribuição registrada nesta reunião.</p>;
  }
  return (
    <ul className="space-y-3">
      {contributions.map((c) => (
        <li key={c.id} className="rounded-[var(--radius)] border border-ink/10 bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">
              {TYPE_ICON[c.type] ?? '💡'} {profiles[c.agentId]?.displayName ?? c.agentId}
              {c.headline ? <span className="ml-2 font-normal text-ink-muted">— {c.headline}</span> : null}
            </p>
            <span className="shrink-0 text-[11px] text-ink-muted">{formatTimeBR(c.createdAt)}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{c.text}</p>
          {c.recommendation ? (
            <p className="mt-1 text-xs text-ink-muted">
              <strong>Recomendação:</strong> {c.recommendation}
            </p>
          ) : null}
          {c.question ? (
            <p className="mt-1 text-xs text-ink-muted">
              <strong>Pergunta:</strong> {c.question}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DecisionsPanel({ decisions }: { decisions: readonly MeetingDecisionRecord[] }) {
  if (decisions.length === 0) {
    return <p className="text-sm text-ink-muted">Nenhuma decisão identificada nesta reunião.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Tópico</th>
            <th className="px-3 py-2">Decisão</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Responsável</th>
            <th className="px-3 py-2">Prazo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {decisions.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 font-medium text-ink">{d.topic}</td>
              <td className="px-3 py-2 text-ink">{d.decision}</td>
              <td className="px-3 py-2">{DECISION_STATUS_LABEL[d.status] ?? d.status}</td>
              <td className="px-3 py-2 text-ink-muted">{d.responsible || '—'}</td>
              <td className="px-3 py-2 text-ink-muted">{d.deadline ? formatDateBR(d.deadline) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActionsPanel({ actionItems }: { actionItems: readonly MeetingActionItemRecord[] }) {
  if (actionItems.length === 0) {
    return <p className="text-sm text-ink-muted">Nenhuma ação identificada nesta reunião.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Ação</th>
            <th className="px-3 py-2">Responsável</th>
            <th className="px-3 py-2">Prazo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {actionItems.map((a) => (
            <tr key={a.id}>
              <td className="px-3 py-2 font-medium text-ink">{a.action}</td>
              <td className="px-3 py-2 text-ink-muted">{a.responsible || '—'}</td>
              <td className="px-3 py-2 text-ink-muted">{a.deadline ? formatDateBR(a.deadline) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
