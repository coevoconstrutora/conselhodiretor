'use client';

import { useEffect } from 'react';
import type { BoardServerMessage } from '@conselho/shared-types';
import { useBoardStore, toContributionItem } from './board-store';
import { resolveWsBase } from './ws-url';

/**
 * `useBoardStream` (Story 3.3 — frontend-spec §11.2): conecta ao WS do board
 * (3.2), parseia mensagens tipadas e empurra contribuições para o
 * `useBoardStore`. Reconexão com backoff curto; o dedup por id no store
 * garante que reenvio pós-reconexão não duplica (AC4).
 */

/** Superfície mínima de WebSocket (mockável em teste — jsdom não conecta). */
export interface BrowserSocketLike {
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: { data?: unknown }) => void): void;
}

export type BrowserSocketFactory = (url: string) => BrowserSocketLike;

export interface UseBoardStreamOptions {
  /** URL base do gateway (default: mesma origem, porta do gateway via env). */
  baseUrl?: string;
  token?: string;
  socketFactory?: BrowserSocketFactory;
  maxRetries?: number;
  retryDelayMs?: number;
}

export function useBoardStream(meetingId: string, opts: UseBoardStreamOptions = {}) {
  const addContribution = useBoardStore((s) => s.addContribution);
  const addTranscript = useBoardStore((s) => s.addTranscript);
  const setSttStatus = useBoardStore((s) => s.setSttStatus);
  const setWsConnected = useBoardStore((s) => s.setWsConnected);
  const setWsGaveUp = useBoardStore((s) => s.setWsGaveUp);

  useEffect(() => {
    const factory: BrowserSocketFactory =
      opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as BrowserSocketLike);
    // baseUrl vazio ⇒ mesma origem (modo attached, A6)
    const base = resolveWsBase(opts.baseUrl || process.env.NEXT_PUBLIC_BOARD_WS_URL);
    const url = `${base}/board?meetingId=${encodeURIComponent(meetingId)}${
      opts.token ? `&token=${encodeURIComponent(opts.token)}` : ''
    }`;
    const maxRetries = opts.maxRetries ?? 5;
    const retryDelayMs = opts.retryDelayMs ?? 1000;

    let socket: BrowserSocketLike | null = null;
    let retries = 0;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      socket = factory(url);
      socket.addEventListener('open', () => {
        setWsConnected(true);
      });
      socket.addEventListener('message', (event) => {
        // retries só zera após MENSAGEM: o gateway completa o handshake ANTES
        // de autenticar — zerar no 'open' tornava wsGaveUp inalcançável com
        // token expirado (loop infinito de reconexão a 1/s)
        retries = 0;
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as BoardServerMessage;
          if (message.v === 1 && message.type === 'transcript') {
            addTranscript(message.text, message.isFinal); // transcrição ao vivo (E7)
            return;
          }
          if (message.v === 1 && message.type === 'status') {
            setSttStatus(message.stt); // saúde do pipeline (A3)
            return;
          }
          const item = toContributionItem(message);
          if (item) addContribution(item);
        } catch {
          // mensagem malformada é ignorada — protocolo versionado (3.2)
        }
      });
      socket.addEventListener('close', () => {
        setWsConnected(false);
        if (disposed) return;
        if (retries >= maxRetries) {
          setWsGaveUp(); // reconexão esgotada — a UI pede recarga (A3)
          return;
        }
        retries += 1;
        retryTimer = setTimeout(connect, retryDelayMs * retries);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [
    meetingId,
    addContribution,
    addTranscript,
    setSttStatus,
    setWsConnected,
    setWsGaveUp,
    opts.baseUrl,
    opts.token,
    opts.socketFactory,
    opts.maxRetries,
    opts.retryDelayMs,
  ]);
}
