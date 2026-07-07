import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { SqlExecutor } from '@conselho/db';
import { validateSession } from '@conselho/auth';
import type { BoardContributionEvent } from '@conselho/board';

/** Fonte de eventos do conselho (FullBoardOrchestrator). */
export interface BoardEventSource {
  subscribe(listener: (event: BoardContributionEvent) => void): () => void;
}
import {
  BOARD_PROTOCOL_VERSION,
  type BoardServerMessage,
} from '@conselho/shared-types';

/**
 * WebSocket Gateway do board (Story 3.2 — ADR-003).
 *
 * Canal de EVENTOS do board, servidor→cliente: contribuições do orchestrator
 * (3.1) chegam ao navegador em tempo real. O áudio NUNCA passa por aqui
 * (architecture §7 — vai pelo SDK do provider de STT).
 *
 * Auth: o cliente conecta em `/board?meetingId=X&token=Y` com o token de
 * sessão (Story 1.2). Token inválido/expirado ou consulta inexistente/de outro
 * usuário ⇒ close 4401/4403 — o gateway nunca entrega eventos sem autorização.
 *
 * Runtime: servidor Node long-lived (`ws`) — coerente com ADR-005 (sessão
 * stateful); a decisão formal de runtime é a Story 3.5.
 */

export interface BoardGatewayOptions {
  /** Porta própria OU server HTTP existente (upgrade). */
  readonly port?: number;
  readonly server?: HttpServer;
  /**
   * A6 — modo DETACHED (`noServer`): nenhum listener próprio; o dono do server
   * HTTP roteia upgrades de /board e /audio para {@link BoardGateway.handleUpgrade}.
   * É o modo do custom server na porta 443 (redes de clínica bloqueiam a 3001).
   * NUNCA usar `{server}` com o server do Next — interceptaria TODOS os upgrades.
   */
  readonly detached?: boolean;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
}

export class BoardGateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<string, Set<WebSocket>>();
  /** Sinks de áudio por consulta (mic real — canal /audio, separado do board §7). */
  private readonly audioSinks = new Map<string, { push(chunk: Uint8Array): void; end(): void }>();
  private readonly unbinders = new Map<string, () => void>();
  /** Último status por consulta — reenviado a clientes que (re)conectam tarde. */
  private readonly lastStatus = new Map<string, BoardServerMessage>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(
    private readonly db: SqlExecutor,
    opts: BoardGatewayOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.wss = opts.detached
      ? new WebSocketServer({ noServer: true })
      : opts.server
        ? new WebSocketServer({ server: opts.server })
        : new WebSocketServer({ port: opts.port ?? 0 });

    // Um socket que emite 'error' sem listener derruba o processo inteiro
    // (que hospeda TODAS as reuniões) — nunca deixar o EventEmitter sem handler.
    this.wss.on('error', (err) => {
      console.error('[gateway] erro no servidor WS:', err);
    });
    this.wss.on('connection', (socket, request) => {
      socket.on('error', (err) => {
        console.error('[gateway] erro em socket de cliente:', err);
        try {
          socket.close(1011, 'erro interno');
        } catch {
          /* socket já fechado */
        }
      });
      void this.onConnection(socket, request.url ?? '');
    });

    // heartbeat (ADR-003): detecta conexões mortas sem derrubar a sessão
    this.heartbeat = setInterval(() => this.pingAll(), opts.heartbeatMs ?? 30_000);
    this.heartbeat.unref?.();
  }

  /** Porta efetiva (útil quando port=0 em teste). */
  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  /**
   * A6 — completa o handshake WS de um upgrade roteado pelo dono do server
   * HTTP (custom server na 443 ou listener legado da 3001). Só faz sentido em
   * modo detached; a auth/roteamento por pathname segue em onConnection.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Conecta um orchestrator (3.1) ao canal da consulta: toda contribuição
   * publicada vira mensagem `contribution` para os clientes conectados.
   */
  bind(meetingId: string, orchestrator: BoardEventSource): void {
    // typeof-guard explícito: o id vem de request — CodeQL (js/unvalidated-
    // dynamic-method-call) exige validar antes de invocar valor dinâmico
    const previousUnbind = this.unbinders.get(meetingId);
    if (typeof previousUnbind === 'function') previousUnbind();
    const unbind = orchestrator.subscribe((event) => this.broadcast(event));
    this.unbinders.set(meetingId, unbind);
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const unbind of this.unbinders.values()) unbind();
    this.unbinders.clear();
    for (const sockets of this.clients.values()) {
      for (const socket of sockets) socket.close(1001, 'gateway closing');
    }
    this.clients.clear();
    await new Promise<void>((resolve, reject) =>
      this.wss.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /** Transcrição ao vivo p/ o TranscriptPanel (E7) — texto, nunca áudio (§7). */
  broadcastTranscript(meetingId: string, text: string, isFinal: boolean): void {
    const payload = JSON.stringify({
      v: BOARD_PROTOCOL_VERSION,
      type: 'transcript',
      text,
      isFinal,
      at: this.now(),
    } satisfies BoardServerMessage);
    for (const socket of this.clients.get(meetingId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  /**
   * Status do pipeline de transcrição (A3): broadcast + cache para replay.
   * `degraded` invisível foi uma das causas do "médico não conseguiu" — o
   * cliente PRECISA saber quando o STT caiu/recuperou.
   */
  broadcastStatus(meetingId: string, stt: 'live' | 'degraded' | 'ended', lastFinalAt: number | null): void {
    const message: BoardServerMessage = {
      v: BOARD_PROTOCOL_VERSION,
      type: 'status',
      stt,
      lastFinalAt,
      at: this.now(),
    };
    this.lastStatus.set(meetingId, message);
    const payload = JSON.stringify(message);
    for (const socket of this.clients.get(meetingId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  /** Registra o destino do áudio do mic real (runtime conecta ao STT). */
  registerAudioSink(
    meetingId: string,
    sink: { push(chunk: Uint8Array): void; end(): void },
  ): void {
    this.audioSinks.get(meetingId)?.end();
    this.audioSinks.set(meetingId, sink);
  }

  unregisterAudioSink(meetingId: string): void {
    this.audioSinks.get(meetingId)?.end();
    this.audioSinks.delete(meetingId);
  }

  /** Há sink de áudio ativo para a consulta? (diagnóstico E2/E3) */
  hasAudioSink(meetingId: string): boolean {
    return this.audioSinks.has(meetingId);
  }

  /** Clientes conectados no canal /board da consulta (diagnóstico). */
  clientCount(meetingId: string): number {
    return this.clients.get(meetingId)?.size ?? 0;
  }

  private async onConnection(socket: WebSocket, url: string): Promise<void> {
    const parsed = new URL(url, 'http://localhost');
    const pathname = parsed.pathname;
    if (pathname !== '/board' && pathname !== '/audio') {
      socket.close(4404, 'path desconhecido');
      return;
    }
    const params = parsed.searchParams;
    const meetingId = params.get('meetingId');
    const token = params.get('token');

    if (!meetingId || !token) {
      socket.close(4400, 'meetingId e token são obrigatórios');
      return;
    }
    const session = await validateSession(this.db, token);
    if (!session) {
      socket.close(4401, 'sessão inválida ou expirada');
      return;
    }
    // a reunião precisa existir e pertencer ao usuário autenticado
    const res = await this.db.query<{ id: string }>(
      'SELECT id FROM meeting WHERE id = $1 AND user_id = $2',
      [meetingId, session.userId],
    );
    if (res.rows.length === 0) {
      socket.close(4403, 'reunião não encontrada para este usuário');
      return;
    }

    if (pathname === '/audio') {
      // mic real: frames binários → sink registrado (runtime → STT). O gate de
      // consentimento já foi exigido ao criar a sessão (1.4); sem sink = sem destino.
      const sink = this.audioSinks.get(meetingId);
      if (!sink) {
        socket.close(4409, 'sessão de áudio não iniciada — inicie a consulta ao vivo primeiro');
        return;
      }
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) sink.push(new Uint8Array(data));
      });
      socket.on('close', () => sink.end());
      return;
    }

    const set = this.clients.get(meetingId) ?? new Set<WebSocket>();
    set.add(socket);
    this.clients.set(meetingId, set);
    socket.on('close', () => {
      set.delete(socket);
    });
    // replay do último status: quem conecta/reconecta tarde vê o estado atual
    const status = this.lastStatus.get(meetingId);
    if (status) socket.send(JSON.stringify(status));
  }

  private broadcast(event: BoardContributionEvent): void {
    const message: BoardServerMessage = {
      v: BOARD_PROTOCOL_VERSION,
      type: 'contribution',
      id: event.id,
      meetingId: event.meetingId,
      triggeredBy: event.triggeredBy,
      at: event.at,
      contribution: {
        agentId: event.contribution.agentId,
        type: event.contribution.type,
        severity: event.contribution.severity,
        text: event.contribution.text,
        relevanceScore: event.contribution.relevanceScore,
      },
      agentIds: (event as { agentIds?: readonly string[] }).agentIds,
      divergent: (event as { divergent?: boolean }).divergent,
    };
    const payload = JSON.stringify(message);
    for (const socket of this.clients.get(event.meetingId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  private pingAll(): void {
    const payload = JSON.stringify({
      v: BOARD_PROTOCOL_VERSION,
      type: 'ping',
      at: this.now(),
    } satisfies BoardServerMessage);
    for (const sockets of this.clients.values()) {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
    }
  }
}
