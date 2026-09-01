'use client';

import { useEffect, useRef } from 'react';
import { useBoardStore } from './board-store';

/**
 * Voz dos conselheiros: toca em áudio cada contribuição nova (ao vivo OU
 * simulada — ambas passam pelo mesmo `useBoardStore`). Fila sequencial (uma
 * voz de cada vez, sem sobrepor) e HTML <audio> puro — sem lib extra.
 * Silencia conselheiros que o usuário silenciou (FR13) e é mutável (🔊/🔇).
 *
 * Barge-in: se ALGUÉM (humano) começa a falar — sinal mais cedo possível é
 * o parcial do STT mudando — a voz do conselheiro que estiver tocando corta
 * NA HORA. Reunião de verdade não tem o board atropelando quem chegou pra
 * falar; a fila retoma no próximo item depois disso, normalmente.
 */
export function useBoardVoice(meetingId: string, muted: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<{ id: string; agentId: string; text: string }>>([]);
  const playedRef = useRef<Set<string>>(new Set());
  const playingRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  /** Resolve o "aguarda o áudio acabar" do pump() ATUAL — usado pelo barge-in
   * pra cortar sem esperar `onended` (pause() sozinho não dispara isso). */
  const resolveCurrentRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    // reinicia a fila/memória de "já tocado" ao trocar de reunião
    queueRef.current = [];
    playedRef.current = new Set();
  }, [meetingId]);

  useEffect(
    () =>
      useBoardStore.subscribe((state, prev) => {
        if (state.contributions === prev.contributions) return;
        const fresh = state.contributions.filter((c) => !playedRef.current.has(c.id));
        for (const item of fresh) {
          playedRef.current.add(item.id);
          if (state.silenced.has(item.contribution.agentId)) continue;
          if (!item.contribution.text.trim()) continue;
          queueRef.current.push({
            id: item.id,
            agentId: item.contribution.agentId,
            text: item.contribution.text,
          });
        }
        void pump();
      }),
    [],
  );

  // barge-in: parcial do STT mudou (e não ficou vazio) = alguém começou a
  // falar AGORA — corta o conselheiro na hora, sem esperar ele terminar.
  useEffect(
    () =>
      useBoardStore.subscribe((state, prev) => {
        if (state.transcript.partial === prev.transcript.partial) return;
        if (!state.transcript.partial) return;
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
        resolveCurrentRef.current?.();
        resolveCurrentRef.current = null;
      }),
    [],
  );

  async function pump(): Promise<void> {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    if (mutedRef.current) {
      void pump(); // descarta em silêncio — mantém a fila drenando
      return;
    }
    playingRef.current = true;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: next.agentId, text: next.text }),
      });
      if (res.ok && audioRef.current) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audioRef.current.src = url;
        useBoardStore.getState().setSpeakingAgent(next.agentId); // sincroniza o indicador com o áudio de verdade
        await audioRef.current.play().catch(() => {});
        await new Promise<void>((resolve) => {
          if (!audioRef.current) return resolve();
          resolveCurrentRef.current = resolve;
          audioRef.current.onended = () => {
            resolveCurrentRef.current = null;
            resolve();
          };
          audioRef.current.onerror = () => {
            resolveCurrentRef.current = null;
            resolve();
          };
        });
        URL.revokeObjectURL(url);
      }
    } catch {
      // falha de rede/TTS não trava a reunião — só essa fala fica muda
    } finally {
      useBoardStore.getState().setSpeakingAgent(null);
      playingRef.current = false;
      void pump();
    }
  }
}
