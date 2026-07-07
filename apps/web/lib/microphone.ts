/**
 * Captura de áudio do navegador (Story 2.2 / FR1, FR20).
 *
 * Isola as APIs de mídia (getUserMedia/MediaRecorder) atrás de funções finas e
 * testáveis (jsdom não as implementa). Nenhum áudio é persistido aqui: a fonte
 * é um AsyncIterable<Uint8Array> consumido pelo adapter `ISttProvider`
 * (SttOpenOptions.audio — Story 2.1), e SÓ deve ser ligada após o gate de
 * consentimento do servidor autorizar (Story 1.4) — o lobby orquestra isso.
 */

export type MicrophoneStatus = 'ok' | 'denied' | 'unavailable';

/** Superfície mínima usada (mockável em teste). */
export interface MediaDevicesLike {
  getUserMedia(constraints: { audio: boolean }): Promise<MediaStream>;
}

/**
 * Checa permissão/disponibilidade do microfone pedindo um stream de áudio.
 * `ok` → stream retornado junto (para reuso na captura, sem pedir 2x).
 */
export async function checkMicrophone(
  mediaDevices: MediaDevicesLike | undefined,
): Promise<{ status: MicrophoneStatus; stream?: MediaStream }> {
  if (!mediaDevices) return { status: 'unavailable' };
  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    return { status: 'ok', stream };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { status: 'denied' };
    return { status: 'unavailable' };
  }
}

/** Subset de MediaRecorder usado (mockável). */
export interface RecorderLike {
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

export type RecorderFactory = (stream: MediaStream, mimeType?: string) => RecorderLike;

export type MimeSupport = { supported: true; mimeType: string } | { supported: false };

/**
 * Formatos aceitos pelo STT streaming (Deepgram): WebM/Opus e Ogg/Opus.
 * Safari/iOS só produz audio/mp4 (AAC) no MediaRecorder — NÃO é confiável no
 * streaming; melhor detectar e avisar do que transcrever silenciosamente nada.
 */
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** Escolhe o melhor mimeType suportado pelo navegador (ou nenhum compatível). */
export function pickRecorderMime(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(type),
): MimeSupport {
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (isTypeSupported(mimeType)) return { supported: true, mimeType };
  }
  return { supported: false };
}

export interface AudioSource {
  /** Chunks de áudio p/ o STT (SttOpenOptions.audio). Termina quando stop() é chamado. */
  chunks: AsyncIterable<Uint8Array>;
  /** Para a captura: encerra o recorder e as tracks (AC5 — revogação/saída). */
  stop(): void;
}

/**
 * Liga a captura: MediaRecorder em timeslice curto → AsyncIterable de chunks.
 * O chamador é responsável por só invocar isto com o gate do servidor autorizado.
 */
export function createAudioSource(
  stream: MediaStream,
  recorderFactory?: RecorderFactory,
  timesliceMs = 250,
  mimeType?: string,
): AudioSource {
  const factory: RecorderFactory =
    recorderFactory ??
    ((s, mime) => new MediaRecorder(s, mime ? { mimeType: mime } : undefined) as unknown as RecorderLike);
  const recorder = factory(stream, mimeType);

  const queue: Array<Uint8Array | null> = [];
  let wake: (() => void) | null = null;
  const push = (item: Uint8Array | null) => {
    queue.push(item);
    wake?.();
    wake = null;
  };

  recorder.ondataavailable = (event) => {
    void event.data.arrayBuffer().then((buf) => push(new Uint8Array(buf)));
  };
  recorder.onstop = () => push(null);
  recorder.start(timesliceMs);

  let stopped = false;
  return {
    chunks: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const item = queue.shift();
          if (item === undefined) {
            if (stopped && queue.length === 0) return;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          if (item === null) return;
          yield item;
        }
      },
    },
    stop() {
      if (stopped) return;
      stopped = true;
      recorder.stop();
      for (const track of stream.getTracks()) track.stop();
      push(null);
    },
  };
}
