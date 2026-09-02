'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  runAutoConfiguratorAction,
  applyAutoConfiguratorAction,
  type AutoConfiguratorActionState,
  type ApplyConfiguratorState,
} from '@/lib/auto-configurator-actions';
import { REASONING_MODELS, REASONING_EFFORTS } from '@/lib/ai-config';
import { SCORE_LABEL_TEXT, classifyScoreLabel, type ConfigurationScore } from '@/lib/auto-configurator-scoring';

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';
const secondaryButtonCls =
  'rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50';

const FOCUS_OPTIONS = [
  { value: 'completo', label: 'Configuração completa' },
  { value: 'perfil', label: 'Perfil e expertise' },
  { value: 'criterios', label: 'Critérios de decisão' },
  { value: 'escopo', label: 'Escopo' },
  { value: 'conhecimento', label: 'Analisar lacunas de conhecimento' },
  { value: 'ia', label: 'Configuração da IA' },
  { value: 'atualizar_tudo', label: 'Atualizar tudo' },
] as const;

function ScoreBadge({ score }: { score: ConfigurationScore }) {
  const label = classifyScoreLabel(score.overall);
  const className =
    label === 'bem_configurado'
      ? 'bg-success/10 text-success'
      : label === 'boa_configuracao'
        ? 'bg-brand/10 text-brand'
        : label === 'revisao_recomendada'
          ? 'bg-attn-bg text-attn-critical'
          : 'bg-attn-critical/10 text-attn-critical';
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {score.overall}/100 · {SCORE_LABEL_TEXT[label]}
    </span>
  );
}

/** Só entra na revisão (e no alvo do "Selecionar todas") quando a proposta difere do valor atual. */
function hasDiff(current: string, proposed: string | null): boolean {
  return Boolean(proposed && proposed.trim() !== current.trim());
}

function DiffField({
  fieldKey,
  label,
  current,
  proposed,
  proposedFieldName,
  checked,
  onToggle,
}: {
  fieldKey: string;
  label: string;
  current: string;
  proposed: string | null;
  proposedFieldName: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  if (!hasDiff(current, proposed)) return null;
  const proposedValue = proposed!;
  return (
    <div className="rounded-[var(--radius)] border border-ink/10 p-3">
      <label className="flex items-start gap-2 text-xs font-semibold text-ink">
        <input
          type="checkbox"
          name={`accept_${fieldKey}`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5"
        />
        <span>{label}</span>
      </label>
      <input type="hidden" name={proposedFieldName} value={proposedValue} />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase text-ink-muted">Atual</p>
          <p className="mt-0.5 whitespace-pre-line text-xs text-ink-muted">{current || '(vazio)'}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-brand">Proposto</p>
          <p className="mt-0.5 whitespace-pre-line text-xs text-ink">{proposedValue}</p>
        </div>
      </div>
    </div>
  );
}

/** "Auto Configurar" (Etapa "Auto Configurador", Seção 8) — gera proposta, revisão campo a campo, aplica só o aprovado. */
export function AutoConfiguratorPanel({ agentId }: { agentId: string }) {
  const [genState, genAction, genPending] = useActionState<AutoConfiguratorActionState, FormData>(
    runAutoConfiguratorAction,
    null,
  );
  const [applyState, applyAction, applyPending] = useActionState<ApplyConfiguratorState, FormData>(
    applyAutoConfiguratorAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  // Valores já aplicados nesta sessão (sem reload) — faz o "Atual" refletir a
  // última aplicação sem precisar remontar o form com um `key` novo.
  const [appliedOverrides, setAppliedOverrides] = useState<Record<string, string>>({});
  // Snapshot do que estava marcado NO MOMENTO do submit — lido pelo efeito de
  // sucesso abaixo; um ref (não um dep de efeito) pra não disparar o efeito
  // a cada toggle de checkbox, só quando `applyState` muda de verdade.
  const acceptedAtSubmitRef = useRef<Record<string, boolean>>({});

  const toggleField = (key: string, value: boolean) => setAccepted((prev) => ({ ...prev, [key]: value }));

  // Proposta nova (outro clique em "Gerar proposta") zera seleção e overrides
  // locais — não deixa aceite/aplicação de uma rodada anterior vazar pra nova.
  useEffect(() => {
    setAccepted({});
    setAppliedOverrides({});
  }, [genState?.proposal]);

  useEffect(() => {
    if (!applyState?.ok || !genState?.proposal) return;
    const acc = acceptedAtSubmitRef.current;
    const proposal = genState.proposal;
    setAppliedOverrides((prev) => {
      const next = { ...prev };
      if (acc.professionalProfile && proposal.professionalProfile) next.professionalProfile = proposal.professionalProfile;
      if (acc.decisionCriteria && proposal.decisionCriteria) next.decisionCriteria = proposal.decisionCriteria;
      if (acc.riskPosture && proposal.riskPosture) next.riskPosture = proposal.riskPosture;
      if (acc.scopeCan && proposal.scopeCan) next.scopeCan = proposal.scopeCan;
      if (acc.scopeCannot && proposal.scopeCannot) next.scopeCannot = proposal.scopeCannot;
      if (acc.aiModel && proposal.aiModelRecommendation) {
        next.aiModel = proposal.aiModelRecommendation.model;
        next.reasoningEffort = proposal.aiModelRecommendation.reasoningEffort;
      }
      return next;
    });
    setAccepted({});
  }, [applyState, genState?.proposal]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonCls}>
        ✨ Auto Configurar
      </button>
    );
  }

  const current = genState?.current
    ? {
        professionalProfile: appliedOverrides.professionalProfile ?? genState.current.professionalProfile ?? '',
        decisionCriteria: appliedOverrides.decisionCriteria ?? genState.current.decisionCriteria ?? '',
        riskPosture: appliedOverrides.riskPosture ?? genState.current.riskPosture ?? '',
        scopeCan: appliedOverrides.scopeCan ?? genState.current.scopeCan,
        scopeCannot: appliedOverrides.scopeCannot ?? genState.current.scopeCannot,
        aiModel: appliedOverrides.aiModel ?? genState.current.aiModel,
        reasoningEffort: appliedOverrides.reasoningEffort ?? genState.current.reasoningEffort,
      }
    : null;

  const fieldDescriptors = genState?.proposal && current
    ? [
        {
          key: 'professionalProfile',
          label: 'Perfil profissional',
          current: current.professionalProfile,
          proposed: genState.proposal.professionalProfile,
          proposedFieldName: 'proposedProfessionalProfile',
        },
        {
          key: 'decisionCriteria',
          label: 'Critérios de decisão',
          current: current.decisionCriteria,
          proposed: genState.proposal.decisionCriteria,
          proposedFieldName: 'proposedDecisionCriteria',
        },
        {
          key: 'riskPosture',
          label: 'Postura de risco',
          current: current.riskPosture,
          proposed: genState.proposal.riskPosture,
          proposedFieldName: 'proposedRiskPosture',
        },
        {
          key: 'scopeCan',
          label: 'O que pode opinar',
          current: current.scopeCan,
          proposed: genState.proposal.scopeCan,
          proposedFieldName: 'proposedScopeCan',
        },
        {
          key: 'scopeCannot',
          label: 'O que não pode opinar',
          current: current.scopeCannot,
          proposed: genState.proposal.scopeCannot,
          proposedFieldName: 'proposedScopeCannot',
        },
      ]
    : [];
  const activeKeys = fieldDescriptors.filter((f) => hasDiff(f.current, f.proposed)).map((f) => f.key);
  const hasAiModelSuggestion = Boolean(genState?.proposal?.aiModelRecommendation);
  const allActiveKeys = hasAiModelSuggestion ? [...activeKeys, 'aiModel'] : activeKeys;
  const selectAll = () => setAccepted(Object.fromEntries(allActiveKeys.map((k) => [k, true])));

  return (
    <div className="space-y-4 rounded-[var(--radius)] border border-brand/20 bg-brand/5 p-4">
      <form action={genAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="agentId" value={agentId} />
        <label className="block">
          <span className="text-xs font-semibold text-ink">Modo</span>
          <select name="focus" defaultValue="completo" className={inputCls}>
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink">
          <input type="checkbox" name="includeHistory" defaultChecked className="mt-0" />
          Usar desempenho histórico
        </label>
        <button type="submit" disabled={genPending} className={buttonCls}>
          {genPending ? 'Analisando…' : 'Gerar proposta'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonCls}>
          Fechar
        </button>
      </form>

      {genState?.error ? <p className="text-xs font-medium text-attn-critical">⚠ {genState.error}</p> : null}

      {genState?.proposal && current && genState.score ? (
        <form
          action={applyAction}
          onSubmit={() => {
            acceptedAtSubmitRef.current = { ...accepted };
          }}
          className="space-y-3"
        >
          <input type="hidden" name="agentId" value={genState.agentId} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ScoreBadge score={genState.score} />
            <p className="text-[11px] text-ink-muted">{genState.dataSufficiencyNote}</p>
          </div>
          {genState.proposal.reasoning ? <p className="text-xs italic text-ink-muted">{genState.proposal.reasoning}</p> : null}

          {allActiveKeys.length > 0 ? (
            <button type="button" onClick={selectAll} className={secondaryButtonCls}>
              ✅ Selecionar todas as sugestões
            </button>
          ) : null}

          {fieldDescriptors.map((f) => (
            <DiffField
              key={f.key}
              fieldKey={f.key}
              label={f.label}
              current={f.current}
              proposed={f.proposed}
              proposedFieldName={f.proposedFieldName}
              checked={accepted[f.key] ?? false}
              onToggle={(v) => toggleField(f.key, v)}
            />
          ))}
          {genState.proposal.expertise.length > 0 ? (
            <div className="rounded-[var(--radius)] border border-ink/10 p-3">
              <p className="text-xs font-semibold text-ink">Expertise sugerida</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                {genState.proposal.expertise.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {genState.proposal.aiModelRecommendation ? (
            <div className="rounded-[var(--radius)] border border-ink/10 p-3">
              <label className="flex items-start gap-2 text-xs font-semibold text-ink">
                <input
                  type="checkbox"
                  name="accept_aiModel"
                  checked={accepted.aiModel ?? false}
                  onChange={(e) => toggleField('aiModel', e.target.checked)}
                  className="mt-0.5"
                />
                <span>Modelo de IA</span>
              </label>
              <input type="hidden" name="accept_reasoningEffort" value="on" />
              <input type="hidden" name="proposedAiModel" value={genState.proposal.aiModelRecommendation.model} />
              <input type="hidden" name="proposedReasoningEffort" value={genState.proposal.aiModelRecommendation.reasoningEffort} />
              <p className="mt-1 text-xs text-ink-muted">
                Atual: {current.aiModel ?? 'padrão'} / {current.reasoningEffort ?? 'padrão'} → Proposto:{' '}
                {REASONING_MODELS.find((m) => m.value === genState.proposal!.aiModelRecommendation!.model)?.label}{' '}
                / {REASONING_EFFORTS.find((r) => r.value === genState.proposal!.aiModelRecommendation!.reasoningEffort)?.label}
              </p>
              <p className="mt-1 text-[11px] italic text-ink-muted">{genState.proposal.aiModelRecommendation.reason}</p>
            </div>
          ) : null}
          {genState.proposal.knowledgeGaps.length > 0 ? (
            <div className="rounded-[var(--radius)] border border-attn/30 bg-attn-bg p-3">
              <p className="text-xs font-semibold text-attn-critical">Lacunas de conhecimento identificadas</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink">
                {genState.proposal.knowledgeGaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <button type="submit" disabled={applyPending} className={buttonCls}>
              {applyPending ? '⏳ Aplicando…' : '💾 Aplicar selecionados'}
            </button>
            {applyState?.ok ? <span className="text-xs font-medium text-success">✓ {applyState.ok}</span> : null}
            {applyState?.error ? <span className="text-xs font-medium text-attn-critical">⚠ {applyState.error}</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
