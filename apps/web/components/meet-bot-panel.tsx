'use client';

import { useState } from 'react';
import { useBoardStore } from '@/lib/board-store';
import { startRecallBotAction, stopRecallBotAction } from '@/lib/recall-actions';
import { ACTION_ERROR_MESSAGES } from '@/lib/action-result';
import { RecallParticipantTile } from './recall-participant-tile';

type PanelState = 'idle' | 'starting' | 'active' | 'error';

/**
 * Bot do Recall.ai (Etapa "Ver participantes/tela compartilhada do Meet") —
 * janela de VISUALIZAÇÃO de uma reunião externa (Google Meet/Zoom/Teams),
 * separada do pipeline de transcrição/board: os conselheiros continuam
 * ouvindo só o microfone/áudio da aba, como sempre. O bot nunca fala nem
 * grava — só entra e mostra quem está na chamada e a tela compartilhada.
 */
export function MeetBotPanel({
  meetingId,
  initialMeetingUrl,
}: {
  meetingId: string;
  /** Link já anexado no agendamento (Etapa "Campo de agendamento") — só um valor inicial editável. */
  initialMeetingUrl?: string | null;
}) {
  const participants = useBoardStore((s) => s.recallParticipants);
  const [meetingUrl, setMeetingUrl] = useState(initialMeetingUrl ?? '');
  const [state, setState] = useState<PanelState>('idle');
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!meetingUrl.trim()) return;
    setState('starting');
    setError(null);
    try {
      const result = await startRecallBotAction(meetingId, meetingUrl.trim());
      if (!result.ok) {
        setError(result.detail ?? ACTION_ERROR_MESSAGES[result.code]);
        setState('error');
        return;
      }
      setState('active');
    } catch {
      setError('Falha ao chamar o bot — tente novamente.');
      setState('error');
    }
  };

  const stop = async () => {
    setState('idle');
    await stopRecallBotAction(meetingId).catch(() => {});
  };

  return (
    <section aria-label="Bot em reunião externa" className="card-premium mt-6 p-6">
      <h2 className="font-display text-base font-semibold text-ink">🤖 Bot em reunião externa</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Ver participantes e tela compartilhada de uma reunião do Google Meet (ou Zoom/Teams) — janela de
        visualização separada; a transcrição dos conselheiros continua vindo do microfone/áudio da aba.
      </p>

      {state !== 'active' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="url"
            placeholder="https://meet.google.com/xxx-xxxx-xxx"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            className="min-w-[280px] flex-1 rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === 'starting' || !meetingUrl.trim()}
            className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {state === 'starting' ? '… entrando' : '🤖 Bot entrar na reunião'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void stop()}
          className="mt-3 rounded-[var(--radius)] bg-attn-critical px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          ⏹ Remover bot da reunião
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}

      {participants.size > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...participants.values()].map((p) => (
            <RecallParticipantTile key={p.participantId} participant={p} />
          ))}
        </div>
      ) : state === 'active' ? (
        <p className="mt-4 text-xs text-ink-muted">Bot conectado — aguardando participantes…</p>
      ) : null}
    </section>
  );
}
