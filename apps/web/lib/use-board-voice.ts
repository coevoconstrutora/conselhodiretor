'use client';

import { useEffect, useRef } from 'react';
import { useBoardStore } from './board-store';

/**
 * Voz dos conselheiros: toca em áudio cada contribuição nova (ao vivo OU
 * simulada — ambas passam pelo mesmo `useBoardStore`). Fila sequencial (uma
 * voz de cada vez, sem sobrepor) e HTML <audio> puro — sem lib extra.
 * Silencia conselheiros que o usuário silenciou (FR13) e é mutável (🔊/🔇).
 */
export function useBoardVoice(meetingId: string, muted: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<{ id: string; agentId: string; text: string }>>([]);
  const playedRef = useRef<Set<string>>(new Set());
  const playingRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

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
        await audioRef.current.play().catch(() => {});
        await new Promise<void>((resolve) => {
          if (!audioRef.current) return resolve();
          audioRef.current.onended = () => resolve();
          audioRef.current.onerror = () => resolve();
        });
        URL.revokeObjectURL(url);
      }
    } catch {
      // falha de rede/TTS não trava a reunião — só essa fala fica muda
    } finally {
      playingRef.current = false;
      void pump();
    }
  }
}
