'use client';

import { useActionState, useState } from 'react';
import {
  updateCounselorProfileAction,
  addTextSourceAction,
  addUrlSourceAction,
  addFileSourceAction,
  type CounselorActionState,
} from '@/lib/counselor-actions';
import { ScopeTextarea, PROFESSIONAL_PROFILE_MAX, DECISION_CRITERIA_MAX } from './scope-textarea';
import { IconPicker } from './icon-picker';
import { RiskPostureField } from './risk-posture-field';
import { getAgentEmoji } from '@/lib/agent-display';

/**
 * Gestão de um conselheiro ("NotebookLM do agente"): edição de perfil e as 3
 * formas de adicionar conhecimento (texto colado, link, arquivo). Cada form
 * usa useActionState — os modos de falha (URL fora do ar, arquivo inválido)
 * precisam ser LIDOS pelo dono, nunca engolidos.
 */

function Feedback({ state }: { state: CounselorActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="mt-2 text-xs font-medium text-attn-critical">
        ⚠ {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="mt-2 whitespace-pre-line text-xs font-medium text-success">
        ✓ {state.ok}
      </p>
    );
  return null;
}

const inputCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';

export function ProfileForm({
  agentId,
  displayName,
  scopeCan,
  scopeCannot,
  iconKey,
  professionalProfile,
  decisionCriteria,
  riskPosture,
  riskPostureNotes,
}: {
  agentId: string;
  displayName: string;
  scopeCan: string;
  scopeCannot: string;
  iconKey: string | null;
  professionalProfile: string | null;
  decisionCriteria: string | null;
  riskPosture: string | null;
  riskPostureNotes: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateCounselorProfileAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <label className="block">
        <span className="text-xs font-semibold text-ink">Nome exibido</span>
        <input name="displayName" defaultValue={displayName} required className={inputCls} />
      </label>
      <div>
        <span className="text-xs font-semibold text-ink">Ícone</span>
        <div className="mt-1">
          <IconPicker name="iconKey" defaultValue={iconKey} emojiFallback={getAgentEmoji(agentId)} />
        </div>
      </div>
      <ScopeTextarea
        name="professionalProfile"
        label="Perfil profissional (formação, senioridade, anos de experiência, certificações)"
        defaultValue={professionalProfile ?? ''}
        maxChars={PROFESSIONAL_PROFILE_MAX}
        rows={2}
        placeholder="ex.: 20 anos em gestão de obras, ex-diretor técnico em incorporadora de médio porte, formado em Engenharia Civil, MBA em Gestão de Projetos"
      />
      <ScopeTextarea
        name="decisionCriteria"
        label="Critérios de decisão (o que ele prioriza ao avaliar propostas)"
        defaultValue={decisionCriteria ?? ''}
        maxChars={DECISION_CRITERIA_MAX}
        rows={2}
        placeholder="ex.: prioriza custo e prazo sobre inovação; exige dados concretos antes de recomendar mudança de método construtivo"
      />
      <RiskPostureField defaultValue={riskPosture ?? ''} defaultNotes={riskPostureNotes ?? ''} />
      <ScopeTextarea name="scopeCan" label="O que pode opinar" defaultValue={scopeCan} required />
      <ScopeTextarea name="scopeCannot" label="O que não pode opinar" defaultValue={scopeCannot} />
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Salvando…' : '💾 Salvar perfil'}
        </button>
      </div>
    </form>
  );
}

export function AddTextForm({ agentId }: { agentId: string }) {
  const [state, formAction, pending] = useActionState(addTextSourceAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <label className="block">
        <span className="text-xs font-semibold text-ink">Título da fonte</span>
        <input
          name="title"
          placeholder='Ex.: "Política de contingência de obra 2026"'
          required
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          Conteúdo (1 fato por linha funciona melhor)
        </span>
        <textarea
          name="content"
          rows={6}
          required
          placeholder={
            '- Contingência começa em 8% do orçamento de obra.\n- Consumo acima de 50% antes dos 60% físicos aciona revisão obrigatória.'
          }
          className={inputCls}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Adicionando…' : '📄 Adicionar texto'}
        </button>
      </div>
    </form>
  );
}

export function AddUrlForm({ agentId }: { agentId: string }) {
  const [state, formAction, pending] = useActionState(addUrlSourceAction, null);
  const [autoRescan, setAutoRescan] = useState(false);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          URL (o sistema baixa a página e extrai o texto)
        </span>
        <input
          name="url"
          type="url"
          placeholder="https://exemplo.com/relatorio-do-setor"
          required
          className={inputCls}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={autoRescan}
          onChange={(e) => setAutoRescan(e.target.checked)}
          className="rounded border-ink/25"
        />
        Revisar automaticamente a cada
        <input
          type="number"
          name="rescanDays"
          min={1}
          max={365}
          defaultValue={30}
          disabled={!autoRescan}
          className="w-16 rounded-[var(--radius)] border border-ink/15 bg-white px-2 py-1 text-xs disabled:opacity-40"
        />
        dia(s)
      </label>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Importando… (até 20s)' : '🔗 Importar link'}
        </button>
      </div>
    </form>
  );
}

export function AddFileForm({ agentId }: { agentId: string }) {
  const [state, formAction, pending] = useActionState(addFileSourceAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <label className="block">
        <span className="text-xs font-semibold text-ink">
          Arquivo .txt, .md, .csv, .pdf ou .docx (máx. 2 MB texto / 15 MB PDF/Word)
        </span>
        <input
          name="file"
          type="file"
          accept=".txt,.md,.markdown,.csv,.pdf,.docx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
          className={`${inputCls} file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Feedback state={state} />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? 'Enviando…' : '📎 Enviar arquivo'}
        </button>
      </div>
    </form>
  );
}
