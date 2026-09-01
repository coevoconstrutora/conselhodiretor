'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SessionSnapshot } from '@conselho/session';
import { useBoardStream } from '@/lib/use-board-stream';
import { useUiTelemetry } from '@/lib/use-ui-telemetry';
import { useBoardVoice } from '@/lib/use-board-voice';
import { useBoardStore } from '@/lib/board-store';
import { TranscriptPanel, type TranscriptSource } from './transcript-panel';
import { SuggestionFeed } from './suggestion-feed';
import { CounselorStrip, type StripCounselor } from './counselor-strip';
import { AlertVignette } from './alert-vignette';
import { LiveMicButton } from './live-mic-button';
import { PipelineStatusBadge } from './pipeline-status-badge';

/**
 * Tela de Consulta (E7 — frontend-spec §4): grid 2 colunas — área principal
 * fluida (transcrição ao vivo) + painel lateral fixo do BOARD (faixa dos
 * doutores, feed com hierarquia de segurança, Modo Foco com tecla F).
 * Em repouso: calmo, zero animação — o olho fica livre p/ o paciente.
 */
export function MeetingRoom({
  meetingId,
  token,
  wsBaseUrl,
  startForm,
  synthesisForm,
  endMeetingButton,
  closed,
  agents,
}: {
  meetingId: string;
  token: string;
  wsBaseUrl: string;
  startForm: React.ReactNode;
  synthesisForm: React.ReactNode;
  endMeetingButton?: React.ReactNode;
  closed?: boolean;
  agents: readonly StripCounselor[];
}) {
  // `useBoardStore` é um singleton global (fora da árvore React): sem isto,
  // trocar de reunião por navegação client-side (sem reload) deixava o
  // feed/transcrição da reunião ANTERIOR visível até a próxima mensagem do WS.
  const clearBoard = useBoardStore((s) => s.clear);
  useEffect(() => {
    clearBoard();
  }, [meetingId, clearBoard]);

  useBoardStream(meetingId, { baseUrl: wsBaseUrl, token });
  useUiTelemetry(meetingId); // E10 — ruído/aceite (R3/§9)
  const [voiceMuted, setVoiceMuted] = useState(false);
  const transcript = useBoardStore((s) => s.transcript);
  const focusMode = useBoardStore((s) => s.focusMode);
  const toggleFocusMode = useBoardStore((s) => s.toggleFocusMode);
  // Modo Foco silencia a voz por padrão (menos ruído quando só ⚠️ importa) —
  // o botão 🔊/🔇 continua valendo por cima disso.
  useBoardVoice(meetingId, voiceMuted || focusMode);

  // Modo Foco com tecla F (FR16) — 1 tecla, sem modificador
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      toggleFocusMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFocusMode]);

  // adapta o transcript do store ao contrato do <TranscriptPanel> (2.4 — REUSE)
  const transcriptSource = useMemo<TranscriptSource>(() => {
    let cached: SessionSnapshot | null = null;
    let cachedFor: typeof transcript | null = null;
    return {
      getSnapshot: () => {
        if (cachedFor !== transcript || !cached) {
          cached = {
            meetingId,
            status: 'live',
            finalSegments: transcript.finals.map((text) => ({ text, isFinal: true })),
            partial: transcript.partial ? { text: transcript.partial, isFinal: false } : null,
            error: null,
          };
          cachedFor = transcript;
        }
        return cached;
      },
      subscribe: () => () => {}, // re-render via zustand — assinatura é no-op
    };
  }, [transcript, meetingId]);

  return (
    <section
      aria-label="Sala do conselho"
      className="surface-deep-gradient gold-hairline rounded-[var(--radius)] border border-white/10 p-4 shadow-sm lg:p-5"
    >
      {/* ⚠️ crítico: a sala inteira responde (vinheta periférica 2s) */}
      <AlertVignette />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          <span className="blueprint-index mr-2 text-white/50">01/</span>
          Sala do Conselho
          <span className="ml-2 text-xs font-normal tracking-wide text-emerald-200/70">
            ● {agents.length} conselheiro{agents.length === 1 ? '' : 's'} presente
            {agents.length === 1 ? '' : 's'}
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={!(voiceMuted || focusMode)}
            disabled={focusMode}
            onClick={() => setVoiceMuted((m) => !m)}
            title={
              focusMode
                ? 'Voz desligada pelo Modo Foco — saia do Modo Foco para religar'
                : voiceMuted
                  ? 'Ativar voz dos conselheiros'
                  : 'Silenciar voz dos conselheiros'
            }
            className="rounded-[var(--radius)] border border-white/25 px-2.5 py-1 text-xs text-white transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {voiceMuted || focusMode ? '🔇 voz' : '🔊 voz'}
          </button>
          <PipelineStatusBadge />
          <span
            title="⚠️ atenção · 💡 sugestão · 🔍 hipótese · 📋 síntese"
            className="cursor-help text-xs text-white/50"
          >
            ⓘ 4 tipos
          </span>
        </div>
      </div>

      {/* faixa hero — os médicos acompanham a reunião, grandes e presentes */}
      <CounselorStrip agents={agents} closed={closed} voiceEnabled={!(voiceMuted || focusMode)} />

      {/* a "mesa" da reunião: transcrição (documento iluminado) + feed */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="flex min-h-[420px] flex-col">
          <TranscriptPanel source={transcriptSource} />
        </div>

        <aside aria-label="Painel do conselho" className="flex min-h-[420px] flex-col gap-3">
          <SuggestionFeed />
        </aside>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          aria-pressed={focusMode}
          onClick={toggleFocusMode}
          className={`rounded-[var(--radius)] px-3 py-2 text-xs font-semibold transition-colors ${
            focusMode
              ? 'bg-white text-surface-deep'
              : 'border border-white/25 text-white hover:bg-white/10'
          }`}
        >
          🔇 Modo Foco <kbd className="ml-1 rounded bg-black/20 px-1">F</kbd>
        </button>
        <div className="flex items-start gap-2">
          {closed ? (
            <span className="rounded-[var(--radius)] border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white/60">
              🔒 Reunião encerrada
            </span>
          ) : (
            <>
              {synthesisForm}
              {startForm}
              <LiveMicButton meetingId={meetingId} token={token} wsBaseUrl={wsBaseUrl} />
            </>
          )}
          {endMeetingButton}
        </div>
      </div>
    </section>
  );
}
