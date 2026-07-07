'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  checkMicrophone,
  createAudioSource,
  type AudioSource,
  type MediaDevicesLike,
  type MicrophoneStatus,
  type RecorderFactory,
} from '@/lib/microphone';

/**
 * Lobby de consulta (Story 2.2 — frontend-spec §3.1): GATING DUPLO antes de
 * qualquer captura de áudio:
 *   1. microfone OK (permissão + dispositivo);
 *   2. gate de consentimento do SERVIDOR autoriza (Story 1.4 — o cliente
 *      apenas reflete o veredito; 401/403 bloqueiam).
 *
 * Só então "Iniciar consulta" libera; ao iniciar, a captura é ligada e a fonte
 * de áudio é entregue via `onStart` (consumida pelo stream STT — 2.1/2.3).
 * Nenhum áudio é persistido aqui.
 */

export interface MeetingLobbyProps {
  meetingId: string;
  onStart: (audio: AudioSource) => void;
  /** Injeções p/ teste (jsdom não tem APIs de mídia). */
  mediaDevices?: MediaDevicesLike;
  recorderFactory?: RecorderFactory;
  fetchImpl?: typeof fetch;
}

type GateStatus = 'checking' | 'authorized' | 'blocked' | 'error';

export function MeetingLobby({
  meetingId,
  onStart,
  mediaDevices,
  recorderFactory,
  fetchImpl,
}: MeetingLobbyProps) {
  const [micStatus, setMicStatus] = useState<MicrophoneStatus | 'checking'>('checking');
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [gate, setGate] = useState<GateStatus>('checking');
  const [started, setStarted] = useState(false);

  const devices =
    mediaDevices ??
    (typeof navigator !== 'undefined' ? (navigator.mediaDevices as MediaDevicesLike) : undefined);
  const doFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);

  const runMicCheck = useCallback(async () => {
    setMicStatus('checking');
    const result = await checkMicrophone(devices);
    setMicStatus(result.status);
    setMicStream(result.stream ?? null);
  }, [devices]);

  const runGateCheck = useCallback(async () => {
    if (!doFetch) {
      setGate('error');
      return;
    }
    try {
      const res = await doFetch(`/api/meetings/${meetingId}/capture-authorization`);
      setGate(res.status === 200 ? 'authorized' : 'blocked');
    } catch {
      setGate('error');
    }
  }, [meetingId, doFetch]);

  useEffect(() => {
    void runMicCheck();
    void runGateCheck();
  }, [runMicCheck, runGateCheck]);

  const ready = micStatus === 'ok' && gate === 'authorized' && !started;

  const start = useCallback(() => {
    if (!ready || !micStream) return;
    setStarted(true);
    onStart(createAudioSource(micStream, recorderFactory));
  }, [ready, micStream, onStart, recorderFactory]);

  if (started) return null;

  return (
    <section aria-label="Preparação da reunião" className="card-premium mx-auto max-w-md space-y-4 p-6">
      <h2 className="font-display text-lg font-semibold text-ink">Antes de começar</h2>

      {/* Etapa 1 — microfone (AC1/AC2) */}
      <div data-testid="mic-step" data-status={micStatus} className="rounded-[var(--radius)] border border-ink/10 p-3">
        {micStatus === 'checking' ? (
          <p className="text-sm text-ink-muted">Verificando microfone…</p>
        ) : micStatus === 'ok' ? (
          <p className="text-sm font-medium text-success">🎙️ Microfone pronto.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-attn">
              {micStatus === 'denied'
                ? 'Permissão de microfone negada. Libere o acesso ao microfone nas permissões do navegador (ícone de cadeado na barra de endereço) e tente de novo.'
                : 'Nenhum microfone disponível. Conecte um microfone e tente de novo.'}
            </p>
            <button
              type="button"
              onClick={() => void runMicCheck()}
              className="rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              Tentar de novo
            </button>
          </div>
        )}
      </div>

      {/* Etapa 2 — consentimento do SERVIDOR (AC3 — Story 1.4) */}
      <div data-testid="gate-step" data-status={gate} className="rounded-[var(--radius)] border border-ink/10 p-3">
        {gate === 'checking' ? (
          <p className="text-sm text-ink-muted">Verificando autorização de gravação…</p>
        ) : gate === 'authorized' ? (
          <p className="text-sm font-medium text-success">🟢 Gravação autorizada pelo servidor.</p>
        ) : gate === 'blocked' ? (
          <p className="text-sm text-attn">
            🔒 Sem consentimento de gravação registrado. Registre o consentimento na página da
            consulta antes de iniciar.
          </p>
        ) : (
          <p className="text-sm text-attn-critical">Falha ao consultar a autorização. Recarregue a página.</p>
        )}
      </div>

      <button
        type="button"
        onClick={start}
        disabled={!ready}
        className="w-full rounded-[var(--radius)] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Iniciar consulta
      </button>
    </section>
  );
}
