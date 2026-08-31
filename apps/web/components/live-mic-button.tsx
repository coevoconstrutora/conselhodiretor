'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startLiveBoardAction, stopLiveBoardAction } from '@/lib/board-actions';
import { ACTION_ERROR_MESSAGES } from '@/lib/action-result';
import { checkMicrophone, createAudioSource, pickRecorderMime, type AudioSource } from '@/lib/microphone';
import { captureTabAudio } from '@/lib/tab-audio';
import { useBoardStore } from '@/lib/board-store';
import { isTranscriptSilent } from '@/lib/pipeline-watchdog';
import { resolveWsBase } from '@/lib/ws-url';

/**
 * Consulta AO VIVO com microfone real (E3 final / Story 2.2 REUSE).
 *
 * Fluxo: (1) server action arma o pipeline (sink de áudio + Deepgram + board);
 * (2) checagem/captura do microfone no navegador (2.2); (3) chunks vão por um
 * WS dedicado `/audio` ao NOSSO servidor — a key do STT nunca toca o browser.
 * O gate de consentimento (1.4) é exigido pelo servidor ao criar a sessão.
 */

type LiveState = 'idle' | 'starting' | 'live' | 'error' | 'stale-deploy';

/** Sinaliza que a invocação de uma server action falhou por infra (deploy stale). */
class StaleDeployError extends Error {}

/**
 * Chama a server action isolando o erro de INFRAESTRUTURA. A action nunca lança
 * por regra de negócio (retorna ActionResult), então QUALQUER throw aqui é
 * transporte/referência órfã pós-deploy — vira `StaleDeployError`, escopado à
 * chamada (não a um match de string interna do Next, frágil entre versões).
 */
async function callAction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new StaleDeployError(err instanceof Error ? err.message : String(err));
  }
}

export function LiveMicButton({
  meetingId,
  token,
  wsBaseUrl,
}: {
  meetingId: string;
  token: string;
  wsBaseUrl: string;
}) {
  const [state, setState] = useState<LiveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [audioSource, setAudioSource] = useState<'mic' | 'tab'>('mic');
  const cleanupRef = useRef<(() => void) | null>(null);

  // Watchdog (A3): "ao vivo" mas NENHUM transcript (nem parcial) em 10s —
  // era exatamente a falha silenciosa que o médico viu em produção.
  useEffect(() => {
    if (state !== 'live') {
      setWarning(null);
      return;
    }
    const liveSince = Date.now();
    const timer = setInterval(() => {
      const last = useBoardStore.getState().pipeline.lastTranscriptAt;
      if (isTranscriptSilent(liveSince, last, Date.now())) {
        setWarning(
          'Ao vivo há 10s sem nenhuma fala transcrita — fale mais perto do microfone ou abra o Diagnóstico.',
        );
      } else if (last && last >= liveSince) {
        setWarning(null);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [state]);

  const stop = useCallback(async () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setState('idle');
    // trata o retorno tipado: se o encerramento no servidor falhou (ex.: sessão
    // web expirada → unauthenticated), avisa em vez de engolir — senão o
    // pipeline (Deepgram/board) pode seguir vivo no servidor sem o médico saber.
    try {
      const result = await stopLiveBoardAction(meetingId);
      if (!result.ok) setError(ACTION_ERROR_MESSAGES[result.code]);
    } catch {
      setError('Não foi possível confirmar o encerramento no servidor — recarregue a página.');
    }
  }, [meetingId]);

  const start = useCallback(async () => {
    setState('starting');
    setError(null);
    let micStream: MediaStream | null = null;
    let serverArmed = false;
    const stopMic = () => micStream?.getTracks().forEach((t) => t.stop());
    try {
      // 1) fonte de áudio PRIMEIRO (Story 2.2): feedback imediato e nenhum
      // pipeline órfão no servidor se a permissão for negada. Duas origens:
      // microfone físico (padrão) ou áudio de uma aba/janela (ex.: Google
      // Meet) — útil quando a sala tem ruído de ambiente que atrapalha o mic.
      if (audioSource === 'tab') {
        const tab = await captureTabAudio(navigator.mediaDevices);
        if (tab.status !== 'ok' || !tab.stream) {
          setError(
            tab.status === 'denied'
              ? 'Compartilhamento de aba cancelado — tente de novo e marque "Compartilhar áudio da aba".'
              : tab.status === 'no-audio-track'
                ? 'Nenhum áudio veio da aba/janela escolhida — marque "Compartilhar áudio da aba" no seletor do navegador.'
                : 'Captura de áudio de aba não suportada neste navegador — use Chrome ou Edge no computador.',
          );
          setState('error');
          return;
        }
        micStream = tab.stream;
      } else {
        const mic = await checkMicrophone(navigator.mediaDevices);
        if (mic.status !== 'ok' || !mic.stream) {
          setError(
            mic.status === 'denied'
              ? 'Permissão de microfone negada — libere no cadeado da barra de endereço e tente de novo.'
              : 'Nenhum microfone disponível.',
          );
          setState('error');
          return;
        }
        micStream = mic.stream;
      }
      const stream: MediaStream = micStream;

      // 2) formato de gravação compatível com o STT (Safari/iOS não tem WebM/Opus
      // e o mp4/AAC transcreve silenciosamente NADA — melhor avisar antes).
      const mime = pickRecorderMime();
      if (!mime.supported) {
        stopMic();
        setError(
          'Este navegador não grava áudio em formato compatível com a transcrição — use Chrome ou Edge no computador.',
        );
        setState('error');
        return;
      }

      // 3) servidor arma o pipeline (Deepgram + sessão + board) — gate 1.4 incluso.
      // callAction isola um throw de infra (deploy stale) do resultado tipado.
      const result = await callAction(() => startLiveBoardAction(meetingId));
      if (!result.ok) {
        stopMic();
        setError(ACTION_ERROR_MESSAGES[result.code]);
        setState('error');
        return;
      }
      serverArmed = true;

      // 4) captura → WS /audio (só áudio binário; eventos do board vão no /board)
      const source: AudioSource = createAudioSource(stream, undefined, undefined, mime.mimeType);
      const ws = new WebSocket(
        `${resolveWsBase(wsBaseUrl)}/audio?meetingId=${encodeURIComponent(meetingId)}&token=${encodeURIComponent(token)}`,
      );
      ws.binaryType = 'arraybuffer';

      let pumping = true;
      let closedByUs = false;
      const teardown = (message: string) => {
        pumping = false;
        source.stop();
        void stopLiveBoardAction(meetingId).catch(() => {});
        setError(message);
        setState('error');
      };
      ws.onopen = () => {
        void (async () => {
          for await (const chunk of source.chunks) {
            if (!pumping || ws.readyState !== WebSocket.OPEN) break;
            ws.send(chunk);
          }
        })();
        setState('live');
      };
      ws.onerror = () => {
        if (closedByUs) return;
        closedByUs = true; // evita o onclose subsequente duplicar o teardown
        teardown('Falha no canal de áudio — verifique a rede e tente novamente.');
      };
      ws.onclose = () => {
        // fechamento LIMPO pelo servidor (deploy/4409) não dispara onerror:
        // sem isto a UI ficava "ao vivo" com o mic quente e nada transcrevendo
        if (closedByUs) return;
        closedByUs = true;
        teardown('O canal de áudio foi encerrado pelo servidor — retome a reunião ao vivo.');
      };
      if (audioSource === 'tab') {
        // usuário pode parar o compartilhamento pela barra nativa do navegador
        // ("Parar de compartilhar") em vez do botão da UI — sem isto, ficava
        // "ao vivo" sem nenhum áudio chegando e sem aviso.
        for (const track of stream.getAudioTracks()) {
          track.onended = () => {
            if (closedByUs) return;
            closedByUs = true;
            teardown('O compartilhamento de áudio da aba foi interrompido — retome a reunião ao vivo.');
          };
        }
      }

      cleanupRef.current = () => {
        closedByUs = true;
        pumping = false;
        source.stop();
        ws.close();
      };
    } catch (err) {
      stopMic();
      // o servidor já estava armado: desarma para não deixar Deepgram/board órfãos
      if (serverArmed) void stopLiveBoardAction(meetingId).catch(() => {});
      if (err instanceof StaleDeployError) {
        setError('O sistema foi atualizado enquanto esta página estava aberta — recarregue a página e tente de novo.');
        setState('stale-deploy');
        return;
      }
      setError(err instanceof Error ? err.message : 'Falha ao iniciar a reunião ao vivo.');
      setState('error');
    }
  }, [meetingId, token, wsBaseUrl, audioSource]);

  return (
    <div className="flex flex-col items-end gap-1">
      {state === 'live' ? (
        <button
          type="button"
          onClick={() => void stop()}
          className="rounded-[var(--radius)] bg-attn-critical px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          ⏹ Encerrar (ao vivo)
        </button>
      ) : (
        <>
          {state === 'idle' || state === 'error' ? (
            <div className="flex items-center gap-1 text-[10px] text-white/70">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="audioSource"
                  checked={audioSource === 'mic'}
                  onChange={() => setAudioSource('mic')}
                />
                Microfone
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="audioSource"
                  checked={audioSource === 'tab'}
                  onChange={() => setAudioSource('tab')}
                />
                Áudio da aba (Meet)
              </label>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === 'starting'}
            className="rounded-[var(--radius)] border border-white/25 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {state === 'starting'
              ? '… preparando'
              : audioSource === 'tab'
                ? '🖥️ Reunião ao vivo (aba)'
                : '🎙️ Reunião ao vivo'}
          </button>
          {audioSource === 'tab' && (state === 'idle' || state === 'error') ? (
            <p className="max-w-[220px] text-right text-[10px] text-white/60">
              No seletor do navegador, escolha a aba do Google Meet e marque
              "Compartilhar áudio da aba".
            </p>
          ) : null}
        </>
      )}
      {error ? <p className="max-w-[220px] text-right text-[10px] text-red-300">{error}</p> : null}
      {warning && !error ? (
        <p className="max-w-[220px] text-right text-[10px] text-amber-300">{warning}</p>
      ) : null}
      {state === 'stale-deploy' ? (
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-[var(--radius)] border border-white/25 px-2 py-1 text-[10px] font-semibold text-white hover:bg-white/10"
        >
          ↻ Recarregar página
        </button>
      ) : null}
    </div>
  );
}
