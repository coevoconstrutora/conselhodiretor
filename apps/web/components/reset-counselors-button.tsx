'use client';

import { useActionState } from 'react';
import { resetDefaultCounselorsAction, type ResetCounselorsState } from '@/lib/counselor-actions';

const CONFIRM_MESSAGE =
  'Resetar os 9 conselheiros + Presidente + Secretária para o perfil de fábrica?\n\n' +
  'Nome, escopo, perfil profissional, critérios de decisão, postura de risco, modelo/raciocínio ' +
  'e voz voltam ao padrão. Conselheiros CUSTOM e a base de conhecimento (o que foi ensinado em ' +
  'cada conselheiro) NÃO são afetados.\n\nEssa ação não tem volta.';

/**
 * "Resetar conselheiros para o padrão" — só o dono da plataforma vê este
 * botão (gate no server component que renderiza este componente). Confirmação
 * nativa antes de submeter: descarta customização do board inteiro de uma
 * empresa de uma vez, não é uma ação de configuração de rotina.
 */
export function ResetCounselorsButton() {
  const [state, formAction, pending] = useActionState<ResetCounselorsState, FormData>(
    resetDefaultCounselorsAction,
    null,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(CONFIRM_MESSAGE)) e.preventDefault();
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius)] border border-attn-critical/30 px-3 py-2 text-xs font-semibold text-attn-critical transition-colors hover:bg-attn-bg disabled:opacity-50"
      >
        {pending ? '⏳ Resetando…' : '🔄 Resetar conselheiros para o padrão'}
      </button>
      {state?.error ? <p className="mt-2 max-w-xs text-xs text-red-600">{state.error}</p> : null}
      {state?.ok ? <p className="mt-2 max-w-xs text-xs text-emerald-700">{state.ok}</p> : null}
    </form>
  );
}
