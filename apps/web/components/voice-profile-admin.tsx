'use client';

import { useActionState } from 'react';
import type { VoiceProfileSummary } from '@/lib/voice-profile';
import { formatDateBR } from '@/lib/format';
import {
  saveVoiceRecognitionToggleAction,
  deleteVoiceProfileAction,
  type VoiceRecognitionToggleState,
} from '@/lib/voice-profile-actions';

/**
 * Reconhecimento de voz ENTRE reuniões (Tier 3 — dado biométrico, LGPD).
 * Toggle opt-in + lista de perfis já cadastrados (nome + área) com exclusão
 * — direito do titular (LGPD Art. 18). Desligado por padrão: nenhuma
 * captura/comparação de voz acontece até isto ser ligado explicitamente.
 */
export function VoiceRecognitionSection({
  enabled,
  profiles,
}: {
  enabled: boolean;
  profiles: readonly VoiceProfileSummary[];
}) {
  const [state, formAction, pending] = useActionState<VoiceRecognitionToggleState, FormData>(
    saveVoiceRecognitionToggleAction,
    null,
  );

  return (
    <div className="card-premium space-y-4 p-6">
      <div>
        <h3 className="text-sm font-semibold text-ink">🎙️ Reconhecimento de voz entre reuniões</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Quando ligado, a voz de quem se autoapresenta ("sou a Marina, da área Jurídica") é
          guardada (cifrada) e passa a ser reconhecida automaticamente em reuniões futuras — sem
          precisar se reapresentar. Isto é <strong>dado biométrico</strong> (LGPD): avise os
          participantes das reuniões. Desligado por padrão; ligar não afeta reuniões já feitas.
        </p>
      </div>

      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="voiceRecognitionEnabled" value={enabled ? '0' : '1'} />
        <button
          type="submit"
          disabled={pending}
          aria-pressed={enabled}
          className={`rounded-[var(--radius)] border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
            enabled
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-ink/15 text-ink-muted hover:bg-surface-muted'
          }`}
        >
          {pending ? '…' : enabled ? '🔓 Ligado — clique para desligar' : '🔒 Desligado — clique para ligar'}
        </button>
        {state?.ok ? <span className="text-xs font-medium text-success">✓ {state.ok}</span> : null}
        {state?.error ? <span className="text-xs font-medium text-attn-critical">⚠ {state.error}</span> : null}
      </form>

      <div>
        <h4 className="text-xs font-semibold text-ink">
          Perfis de voz cadastrados <span className="font-normal text-ink-muted">· {profiles.length}</span>
        </h4>
        {profiles.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            Nenhum ainda — o primeiro perfil nasce quando alguém se autoapresenta numa reunião com
            isto ligado.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-ink/10">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">
                    {p.name}
                    {p.area ? <span className="text-ink-muted"> · {p.area}</span> : null}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    desde {formatDateBR(p.createdAt)} · {p.sampleCount} amostra{p.sampleCount === 1 ? '' : 's'}
                  </p>
                </div>
                <form action={deleteVoiceProfileAction}>
                  <input type="hidden" name="profileId" value={p.id} />
                  <button
                    type="submit"
                    aria-label={`Remover perfil de voz de ${p.name}`}
                    className="shrink-0 rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-xs text-attn-critical transition-colors hover:bg-attn-bg"
                  >
                    🗑 Remover
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
