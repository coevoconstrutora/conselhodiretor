'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveVoiceRecognitionToggleAction, type VoiceRecognitionToggleState } from '@/lib/voice-profile-actions';

/**
 * Reconhecimento de voz ENTRE reuniões (dado biométrico, LGPD) — interruptor
 * GERAL da empresa. O cadastro/gestão de biometria por pessoa vive em
 * /participants (Etapa "Participantes") — aqui é só liga/desliga.
 */
export function VoiceRecognitionSection({ enabled }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState<VoiceRecognitionToggleState, FormData>(
    saveVoiceRecognitionToggleAction,
    null,
  );

  return (
    <div className="card-premium space-y-4 p-6">
      <div>
        <h3 className="text-sm font-semibold text-ink">🎙️ Reconhecimento de voz entre reuniões</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Quando ligado, participantes com voz cadastrada (em{' '}
          <Link href="/participants" className="underline hover:text-ink">
            /participants
          </Link>
          ) passam a ser reconhecidos automaticamente em reuniões futuras. Isto é{' '}
          <strong>dado biométrico</strong> (LGPD): avise os participantes das reuniões. Desligado
          por padrão; ligar não afeta reuniões já feitas.
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

      <Link
        href="/participants"
        className="inline-block rounded-[var(--radius)] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted"
      >
        👥 Gerenciar participantes e biometria
      </Link>
    </div>
  );
}
