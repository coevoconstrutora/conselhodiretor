import type {
  ISttProvider,
  SttSession,
  SttOpenOptions,
  TranscriptSegment,
} from '@conselho/providers';

/**
 * Adapter Deepgram para `ISttProvider` (Story 2.1 / FR1, NFR8).
 *
 * Implementado sobre o WebSocket nativo (WHATWG, Node 22+) — sem SDK de vendor:
 * a dependência externa é só o protocolo público (`wss://api.deepgram.com/v1/listen`).
 * Autenticação via subprotocolo `['token', apiKey]` (suportado pelo Deepgram;
 * o WebSocket WHATWG não permite headers).
 *
 * - Parciais/finais: `interim_results=true`; `is_final` mapeia `TranscriptSegment.isFinal`.
 * - Latência (NFR5): cada segmento carrega `startMs`/`endMs` (offsets do áudio,
 *   do payload do vendor) + `receivedAtMs` (chegada no cliente) — insumo da POC 2.5.
 * - Vocabulário clínico (T4 / Story 2.6): `vocabularyBoost` vira `keywords=` na URL.
 * - O domínio nunca importa este package: ele recebe `ISttProvider` injetado (NFR8).
 */

/** Fábrica de WebSocket injetável — testes substituem por um socket de replay. */
export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

/** Evento mínimo entregue aos listeners (subset de MessageEvent/CloseEvent). */
export interface WsEventLike {
  readonly data?: unknown;
  readonly code?: number;
}

/** Superfície mínima de WebSocket usada pelo adapter (WHATWG-compatível). */
export interface WebSocketLike {
  send(data: string | ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: WsEventLike) => void,
  ): void;
}

export interface DeepgramConfig {
  readonly apiKey: string;
  /** Endpoint do protocolo listen (default produção). */
  readonly endpoint?: string;
  /** Modelo Deepgram (default nova-2, com PT-BR). */
  readonly model?: string;
  readonly socketFactory?: WebSocketFactory;
  /** Relógio injetável p/ `receivedAtMs` determinístico em teste. */
  readonly now?: () => number;
}

/** Erro tipado do adapter (AC5) — a sessão 2.3 degrada a partir dele. */
export class DeepgramSttError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'connection' | 'protocol',
  ) {
    super(message);
    this.name = 'DeepgramSttError';
  }
}

const DEFAULT_ENDPOINT = 'wss://api.deepgram.com/v1/listen';

/** Constrói config do ambiente (`DEEPGRAM_API_KEY`) — erro claro se ausente (AC6). */
export function deepgramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeepgramConfig {
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new DeepgramSttError(
      'DEEPGRAM_API_KEY ausente — configure a credencial do STT no ambiente (.env).',
      'config',
    );
  }
  return { apiKey };
}

export class DeepgramSttProvider implements ISttProvider {
  constructor(private readonly config: DeepgramConfig) {
    if (!config.apiKey) {
      throw new DeepgramSttError('apiKey vazia — credencial do Deepgram é obrigatória.', 'config');
    }
  }

  openStream(opts: SttOpenOptions): SttSession {
    const url = buildListenUrl(this.config, opts);
    const factory: WebSocketFactory =
      this.config.socketFactory ??
      ((u, protocols) => new WebSocket(u, protocols) as unknown as WebSocketLike);
    const socket = factory(url, ['token', this.config.apiKey]);
    const now = this.config.now ?? Date.now;

    return new DeepgramSession(socket, opts.audio, now);
  }
}

export function buildListenUrl(config: DeepgramConfig, opts: SttOpenOptions): string {
  const model = config.model ?? 'nova-2';
  const url = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
  url.searchParams.set('model', model);
  url.searchParams.set('language', opts.lang); // PT-BR (NFR11)
  url.searchParams.set('interim_results', 'true'); // parciais + finais (AC2)
  url.searchParams.set('smart_format', 'true');
  // Boost do vocabulário clínico (T4). O Nova-3 SUBSTITUIU `keywords` por
  // `keyterm` (contextual, model-driven, multilíngue, até ~100 termos): setar
  // `keywords` no nova-3 é silenciosamente IGNORADO pelo Deepgram. Escolhemos o
  // parâmetro pelo modelo para a POC 2.5 poder comparar nova-2+keywords vs
  // nova-3+keyterm sem tocar o resto do pipeline.
  const boostParam = model.startsWith('nova-3') ? 'keyterm' : 'keywords';
  for (const term of opts.vocabularyBoost ?? []) {
    url.searchParams.append(boostParam, term);
  }
  return url.toString();
}

/** Shape relevante das mensagens `Results` do protocolo listen do Deepgram. */
interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  start?: number; // segundos
  duration?: number; // segundos
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

class DeepgramSession implements SttSession {
  private readonly queue: Array<TranscriptSegment | Error | null> = [];
  private wake: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly socket: WebSocketLike,
    audio: AsyncIterable<Uint8Array> | undefined,
    private readonly now: () => number,
    connectTimeoutMs = 15_000,
  ) {
    // Timeout de handshake: um WS que nunca dispara open/error/close travaria
    // o consumidor para sempre — aqui vira erro de conexão explícito.
    const connectTimer = setTimeout(() => {
      this.push(
        new DeepgramSttError(
          `STT (Deepgram) não conectou em ${connectTimeoutMs}ms (timeout de handshake).`,
          'connection',
        ),
      );
    }, connectTimeoutMs);
    connectTimer.unref?.();

    socket.addEventListener('message', (event) => {
      this.onMessage(event.data);
    });
    socket.addEventListener('error', () => {
      clearTimeout(connectTimer);
      this.push(new DeepgramSttError('Falha na conexão com o STT (Deepgram).', 'connection'));
    });
    socket.addEventListener('close', (event) => {
      clearTimeout(connectTimer);
      if (event.code === 1000 || this.closed) this.push(null);
      else
        this.push(
          new DeepgramSttError(
            `Conexão STT encerrada inesperadamente (code ${event.code}).`,
            'connection',
          ),
        );
    });
    socket.addEventListener('open', () => {
      clearTimeout(connectTimer);
      if (audio) void this.pumpAudio(audio);
    });
  }

  /** Bombeia a fonte de áudio (Story 2.2) para o socket; fim → CloseStream. */
  private async pumpAudio(audio: AsyncIterable<Uint8Array>): Promise<void> {
    try {
      for await (const chunk of audio) {
        if (this.closed) return;
        this.socket.send(chunk);
      }
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
    } catch (err) {
      this.push(
        new DeepgramSttError(
          `Fonte de áudio falhou: ${err instanceof Error ? err.message : String(err)}`,
          'protocol',
        ),
      );
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return; // só JSON de resultados interessa
    let msg: DeepgramResultsMessage;
    try {
      msg = JSON.parse(data) as DeepgramResultsMessage;
    } catch {
      this.push(new DeepgramSttError('Mensagem inválida do STT (JSON malformado).', 'protocol'));
      return;
    }
    if (msg.type !== 'Results') return; // Metadata/UtteranceEnd etc. são ignorados
    const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
    if (text === '') return; // resultados vazios não viram segmento
    const startMs = msg.start !== undefined ? Math.round(msg.start * 1000) : undefined;
    const segment: TranscriptSegment = {
      text,
      isFinal: msg.is_final === true,
      startMs,
      endMs:
        msg.start !== undefined && msg.duration !== undefined
          ? Math.round((msg.start + msg.duration) * 1000)
          : undefined,
      receivedAtMs: this.now(),
    };
    this.push(segment);
  }

  private push(item: TranscriptSegment | Error | null): void {
    this.queue.push(item);
    this.wake?.();
    this.wake = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
    for (;;) {
      const item = this.queue.shift();
      if (item === undefined) {
        if (this.closed) return;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      if (item === null) return;
      if (item instanceof Error) throw item;
      yield item;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.close(1000, 'client closed');
    this.push(null);
  }
}
