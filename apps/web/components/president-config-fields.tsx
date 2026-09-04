'use client';

import { useActionState } from 'react';
import {
  REASONING_MODELS,
  REASONING_EFFORTS,
  INTERVENTION_LEVELS,
  CONSENSUS_POLICIES,
  DEFAULT_AI_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_INTERVENTION_LEVEL,
  DEFAULT_CONSENSUS_POLICY,
  findReasoningModel,
} from '@/lib/ai-config';
import { updatePresidentConfigAction, type PresidentActionState } from '@/lib/president-actions';
import type { PresidentConfig } from '@conselho/kb';

const selectCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

function Feedback({ state }: { state: PresidentActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="mt-2 text-xs font-medium text-attn-critical">
        ⚠ {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="mt-2 text-xs font-medium text-success">
        ✓ {state.ok}
      </p>
    );
  return null;
}

/**
 * "Configuração do Presidente" (governança — Etapa homônima): DOIS modelos
 * separados (acompanhamento vs. síntese), mais o raciocínio da síntese FINAL
 * de encerramento, mais nível de intervenção e autoridade. Distinto da
 * "Configuração da IA" genérica (que o Presidente também tem, para voz) —
 * aqui é o que de fato governa as chamadas de LLM do papel de Presidente.
 */
export function PresidentConfigFields({ config }: { config: PresidentConfig }) {
  const [state, formAction, pending] = useActionState(updatePresidentConfigAction, null);
  const monitoringInfo = findReasoningModel(config.monitoringModel);
  const synthesisInfo = findReasoningModel(config.synthesisModel);

  return (
    <form action={formAction} className="space-y-4">
      <div className="rounded-[var(--radius)] border border-ink/10 bg-surface-muted/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Modelo de acompanhamento</h3>
        <p className="mt-1 text-[11px] text-ink-muted">
          Usado para acompanhar a reunião, analisar contribuições e identificar decisões, divergências
          e assuntos pendentes.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink">Modelo</span>
            <select name="monitoringModel" defaultValue={config.monitoringModel ?? DEFAULT_AI_MODEL} className={selectCls}>
              {REASONING_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {monitoringInfo ? <p className="mt-1 text-[11px] text-ink-muted">{monitoringInfo.description}</p> : null}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">Nível de raciocínio</span>
            <select
              name="monitoringReasoningEffort"
              defaultValue={config.monitoringReasoningEffort ?? DEFAULT_REASONING_EFFORT}
              className={selectCls}
            >
              {REASONING_EFFORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-ink/10 bg-surface-muted/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Modelo de síntese</h3>
        <p className="mt-1 text-[11px] text-ink-muted">
          Usado para sínteses executivas, consolidação de pareceres e análise de decisões complexas
          (botão &quot;Síntese do Presidente&quot; e síntese automática da reunião).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink">Modelo</span>
            <select name="synthesisModel" defaultValue={config.synthesisModel ?? DEFAULT_AI_MODEL} className={selectCls}>
              {REASONING_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {synthesisInfo ? <p className="mt-1 text-[11px] text-ink-muted">{synthesisInfo.description}</p> : null}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">Nível de raciocínio</span>
            <select
              name="synthesisReasoningEffort"
              defaultValue={config.synthesisReasoningEffort ?? DEFAULT_REASONING_EFFORT}
              className={selectCls}
            >
              {REASONING_EFFORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-ink">Raciocínio da síntese final (encerramento da reunião)</span>
          <select
            name="finalSynthesisReasoningEffort"
            defaultValue={config.finalSynthesisReasoningEffort ?? 'xhigh'}
            className={selectCls}
          >
            {REASONING_EFFORTS.filter((o) => ['medium', 'high', 'xhigh'].includes(o.value)).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-muted">
            Usado só 1x, no encerramento da reunião — não use este nível continuamente durante a reunião.
          </p>
        </label>
      </div>

      <div className="rounded-[var(--radius)] border border-ink/10 bg-surface-muted/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Governança</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink">Nível de intervenção</span>
            <select
              name="interventionLevel"
              defaultValue={config.interventionLevel ?? DEFAULT_INTERVENTION_LEVEL}
              className={selectCls}
            >
              {INTERVENTION_LEVELS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-muted">
              Define com que frequência o Presidente participa ativamente da reunião.
            </p>
          </label>
          <div className="block">
            <span className="text-xs font-semibold text-ink">Política de consenso</span>
            <p className={`${selectCls} bg-surface-muted text-ink-muted`}>
              {CONSENSUS_POLICIES.find((p) => p.value === (config.consensusPolicy ?? DEFAULT_CONSENSUS_POLICY))?.label}
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">
              O Presidente nunca fabrica consenso — divergências entre conselheiros são sempre expostas.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              name="canRequestCounselors"
              defaultChecked={config.canRequestCounselors}
              className="mt-0.5"
            />
            <span>Pode solicitar parecer de um conselheiro específico quando faltar competência na discussão</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              name="canRegisterDecisions"
              defaultChecked={config.canRegisterDecisions}
              className="mt-0.5"
            />
            <span>Pode registrar decisões efetivamente tomadas pelo conselho</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              name="canOverrideSpecialist"
              defaultChecked={config.canOverrideSpecialist}
              className="mt-0.5"
            />
            <span>Pode substituir a conclusão de um especialista sem justificativa (não recomendado)</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-ink">
            <input type="checkbox" name="autoInterruption" defaultChecked={config.autoInterruption} className="mt-0.5" />
            <span>Interrompe automaticamente para eventos críticos, mesmo fora do nível de intervenção configurado</span>
          </label>
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-ink/10 bg-surface-muted/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Análise de fala (experimental)</h3>
        <label className="mt-3 flex items-start gap-2 text-xs text-ink">
          <input
            type="checkbox"
            name="speechToneAnalysisEnabled"
            defaultChecked={config.speechToneAnalysisEnabled}
            className="mt-0.5"
          />
          <span>
            Gerar, por IA, uma leitura aproximada de ESTILO de linguagem por participante (direto/hesitante,
            afirmativo/interrogativo) — nunca estado emocional ou psicológico. Fica só na página de cada
            participante, nunca entra na síntese do Presidente. Desligado por padrão.
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Salvando…' : '💾 Salvar configuração do Presidente'}
        </button>
      </div>
    </form>
  );
}
