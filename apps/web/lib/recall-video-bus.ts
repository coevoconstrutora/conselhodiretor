/**
 * Barramento de frames de vídeo do bot do Recall.ai (Etapa "Ver
 * participantes/tela compartilhada do Meet") — DELIBERADAMENTE fora do
 * Zustand: um frame de vídeo chega várias vezes por segundo por
 * participante, e cada um viraria um `set()`/re-render se passasse pelo
 * `useBoardStore` (que já carrega o feed inteiro de contribuições).
 * Aqui é só um pub/sub simples; quem desenha (WebCodecs + canvas) assina
 * direto o participante que importa, fora do ciclo de render do React.
 */

export interface RecallVideoFrame {
  readonly videoType: 'webcam' | 'screenshare';
  readonly bufferB64: string;
  readonly at: number;
}

type Listener = (frame: RecallVideoFrame) => void;

const listeners = new Map<number, Set<Listener>>();

export function subscribeRecallVideo(participantId: number, listener: Listener): () => void {
  const set = listeners.get(participantId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(participantId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(participantId);
  };
}

export function publishRecallVideo(participantId: number, frame: RecallVideoFrame): void {
  for (const listener of listeners.get(participantId) ?? []) listener(frame);
}
