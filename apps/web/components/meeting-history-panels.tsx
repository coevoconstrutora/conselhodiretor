import Link from 'next/link';
import type {
  MeetingContributionRecord,
  MeetingDecisionRecord,
  MeetingActionItemRecord,
  MeetingImprovement,
} from '@conselho/meeting-report';
import type { AgentProfile } from '@conselho/kb';
import type { AgentId } from '@conselho/providers';
import type { ParticipantSignal } from '@/lib/participant-signals';
import { formatDateBR, formatTimeBR, formatSpeakingDuration } from '@/lib/format';
import { updateDecisionStatusAction, updateActionItemStatusAction } from '@/lib/decision-actions';
import { GenerateOutcomeButton } from './generate-outcome-button';

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

/**
 * "Itens monitorados" (Etapa "Acompanhamento") — status editável direto na
 * tabela, sem JS: `<select>` dentro de um `<form>` com botão de submit.
 * Marca `manuallyEdited=true`, que sobrevive à próxima regeneração dos
 * relatórios (a IA reextrai, mas o status manual é preservado quando o texto
 * casa com o item editado — ver `saveMeetingOutcome`).
 */
export function DecisionsPanel({
  decisions,
  meetingId,
  canEdit,
}: {
  decisions: readonly MeetingDecisionRecord[];
  meetingId: string;
  canEdit: boolean;
}) {
  if (decisions.length === 0) {
    return (
      <div>
        <p className="text-sm text-ink-muted">Nenhuma decisão identificada nesta reunião.</p>
        {canEdit ? <GenerateOutcomeButton meetingId={meetingId} /> : null}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
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
              <td className="px-3 py-2">
                {canEdit ? (
                  <form action={updateDecisionStatusAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="meetingId" value={meetingId} />
                    <input type="hidden" name="decisionId" value={d.id} />
                    <select
                      name="status"
                      defaultValue={d.status}
                      className="rounded-[var(--radius)] border border-ink/15 bg-white px-1.5 py-1 text-xs text-ink"
                    >
                      {Object.entries(DECISION_STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-[var(--radius)] border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-surface-muted"
                    >
                      Salvar
                    </button>
                    {d.manuallyEdited ? <span className="text-[10px] text-ink-muted" title="Editado à mão">✎</span> : null}
                  </form>
                ) : (
                  <span>
                    {DECISION_STATUS_LABEL[d.status] ?? d.status}
                    {d.manuallyEdited ? <span className="ml-1 text-[10px] text-ink-muted">✎</span> : null}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-ink-muted">{d.responsible || '—'}</td>
              <td className="px-3 py-2 text-ink-muted">{d.deadline ? formatDateBR(d.deadline) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Análise do Conselho" (Etapa "Auto-análise", Seção 30) — resumo compacto + link pro Aprendizado do Conselho. */
export function AnalysisSummaryCard({ analysis }: { analysis: MeetingImprovement | null }) {
  if (!analysis?.analysis) return null;
  const a = analysis.analysis;
  return (
    <section aria-label="Análise do Conselho" className="card-premium mt-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">🧠 Análise do Conselho</h2>
        {a.overallScore !== null ? (
          <span className="rounded-full bg-brand/10 px-3 py-1 text-sm font-semibold text-brand">
            Score: {a.overallScore}/100
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{analysis.narrative}</p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
        {a.scores.redundancyControl !== null ? <span>Redundância: {100 - a.scores.redundancyControl}%</span> : null}
        {a.scores.decisionClarity !== null ? <span>Clareza das decisões: {a.scores.decisionClarity}/100</span> : null}
        {a.scores.actionItemQuality !== null ? <span>Qualidade das ações: {a.scores.actionItemQuality}/100</span> : null}
        {a.costAnalysis.estimatedCostUsd !== null ? <span>Custo IA: US$ {a.costAnalysis.estimatedCostUsd.toFixed(2)}</span> : null}
      </div>
      <Link href="/improvements" className="mt-3 inline-block text-xs font-semibold text-brand hover:underline">
        Ver análise completa →
      </Link>
    </section>
  );
}

export function ActionsPanel({
  actionItems,
  meetingId,
  canEdit,
}: {
  actionItems: readonly MeetingActionItemRecord[];
  meetingId: string;
  canEdit: boolean;
}) {
  if (actionItems.length === 0) {
    return (
      <div>
        <p className="text-sm text-ink-muted">Nenhuma ação identificada nesta reunião.</p>
        {canEdit ? <GenerateOutcomeButton meetingId={meetingId} /> : null}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Ação</th>
            <th className="px-3 py-2">Responsável</th>
            <th className="px-3 py-2">Prazo</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {actionItems.map((a) => {
            const isDone = a.status === 'concluida';
            const nextStatus = isDone ? 'pendente' : 'concluida';
            return (
              <tr key={a.id}>
                <td className={`px-3 py-2 font-medium ${isDone ? 'text-ink-muted line-through' : 'text-ink'}`}>{a.action}</td>
                <td className="px-3 py-2 text-ink-muted">{a.responsible || '—'}</td>
                <td className="px-3 py-2 text-ink-muted">{a.deadline ? formatDateBR(a.deadline) : '—'}</td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <form action={updateActionItemStatusAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="meetingId" value={meetingId} />
                      <input type="hidden" name="actionItemId" value={a.id} />
                      <input type="hidden" name="status" value={nextStatus} />
                      <button
                        type="submit"
                        className={`rounded-[var(--radius)] border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          isDone
                            ? 'border-ink/15 text-ink-muted hover:bg-surface-muted'
                            : 'border-success/30 text-success hover:bg-success/10'
                        }`}
                      >
                        {isDone ? '↺ Reabrir' : '✓ Concluir'}
                      </button>
                      {a.manuallyEdited ? <span className="text-[10px] text-ink-muted" title="Editado à mão">✎</span> : null}
                    </form>
                  ) : (
                    <span className="text-xs text-ink-muted">{isDone ? '✓ Concluída' : '⏳ Pendente'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "Participantes" (Etapa "Análise de fala dos presentes") — tempo de fala,
 * trocas abruptas de turno e (opt-in) tom de linguagem, lado a lado por
 * participante. Os dados já são calculados ao encerrar a reunião
 * (`computeParticipantMeetingAnalytics`); isto só exibe o que já existe —
 * antes só aparecia espalhado, um por vez, no perfil de cada participante.
 */
export function ParticipantSignalsPanel({
  signals,
  speechTone,
}: {
  signals: readonly ParticipantSignal[];
  /** participantId -> texto do tom de linguagem (vazio quando a análise está desligada ou ainda não rodou). */
  speechTone: ReadonlyMap<string, string>;
}) {
  if (signals.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nenhum sinal de participação calculado para esta reunião (precisa de transcrição com locutores
        identificados).
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Participante</th>
              <th className="px-3 py-2">Tempo de fala</th>
              <th className="px-3 py-2">Intervenções</th>
              <th className="px-3 py-2">Fatia da fala</th>
              <th className="px-3 py-2">Trocas abruptas de turno</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {signals.map((s) => (
              <tr key={s.participantId ?? s.name}>
                <td className="px-3 py-2 font-medium text-ink">{s.name}</td>
                <td className="px-3 py-2 text-ink-muted">
                  {s.speakingMs > 0 ? formatSpeakingDuration(s.speakingMs) : '—'}
                </td>
                <td className="px-3 py-2 text-ink-muted">{s.speakingTurns}</td>
                <td className="px-3 py-2 text-ink-muted">
                  {s.speechShare !== null ? `${Math.round(s.speechShare * 100)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-ink-muted">{s.interruptionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-muted">
        "Trocas abruptas de turno" é uma aproximação por proximidade temporal (troca de locutor a ≤300ms
        do fim da fala anterior) — nunca uma medição real de sobreposição de áudio.
      </p>
      {signals.some((s) => s.participantId && speechTone.get(s.participantId)) ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-ink">Tom de linguagem (IA, aproximado)</h3>
          {signals.map((s) => {
            const tone = s.participantId ? speechTone.get(s.participantId) : null;
            if (!tone) return null;
            return (
              <details key={s.participantId} className="rounded-[var(--radius)] border border-ink/10 bg-surface p-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">{s.name}</summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{tone}</p>
              </details>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
