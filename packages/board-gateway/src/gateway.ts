import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { SqlExecutor } from '@conselho/db';
import { validateSession } from '@conselho/auth';
import type { BoardContributionEvent } from '@conselho/board';
import { verifyRecallRequest } from './recall-verify';

/** Fonte de eventos do conselho (FullBoardOrchestrator). */
export interface BoardEventSource {
  subscribe(listener: (event: BoardContributionEvent) => void): () => void;
}
import {
  BOARD_PROTOCOL_VERSION,
  type BoardServerMessage,
} from '@conselho/shared-types';

/** Recall.ai (Etapa "Ver participantes/tela compartilhada") — nomes de evento
 * de participante que o bot manda, mapeados pro tipo aditivo do protocolo. */
export const RECALL_PARTICIPANT_EVENTS: Record<
  string,
  'join' | 'leave' | 'webcam_on' | 'webcam_off' | 'screenshare_on' | 'screenshare_off'
> = {
  'participant_events.join': 'join',
  'participant_events.leave': 'leave',
  'participant_events.webcam_on': 'webcam_on',
  'participant_events.webcam_off': 'webcam_off',
  'participant_events.screenshare_on': 'screenshare_on',
  'participant_events.screenshare_off': 'screenshare_off',
};

function headerValue(h: string | string[] | undefined): string | null {
  return Array.isArray(h) ? (h[0] ?? null) : (h ?? null);
}

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
      void this.onConnection(socket, request.url ?? '', request.headers);
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

  /** Relay de eventos/vídeo do bot do Recall.ai (Etapa "Ver participantes/tela
   * compartilhada") pros clientes já conectados em /board da mesma reunião —
   * janela de visualização, nunca entra no protocolo de transcrição/board. */
  private broadcastRecallMessage(meetingId: string, message: BoardServerMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.clients.get(meetingId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  /**
   * Upgrade do `/recall-media` — NÃO é um cliente autenticado por sessão de
   * usuário (como /board e /audio): é o PRÓPRIO Recall.ai conectando pra
   * entregar vídeo/eventos em tempo real. Autenticado por HMAC (mesmo
   * esquema do webhook), nunca por token de sessão.
   */
  private onRecallConnection(socket: WebSocket, params: URLSearchParams, headers: IncomingHttpHeaders): void {
    const meetingId = params.get('meetingId');
    if (!meetingId) {
      socket.close(4400, 'meetingId obrigatório');
      return;
    }
    const secret = process.env.RECALL_WEBHOOK_SECRET;
    const verified =
      !!secret &&
      verifyRecallRequest(
        secret,
        {
          id: headerValue(headers['webhook-id']),
          timestamp: headerValue(headers['webhook-timestamp']),
          signature: headerValue(headers['webhook-signature']),
        },
        null,
      );
    if (!verified) {
      socket.close(4401, 'assinatura inválida');
      return;
    }
    socket.on('message', (data) => this.handleRecallMessage(meetingId, data.toString()));
  }

  /** Parseia UMA mensagem JSON do bot (vídeo ou evento de participante) e relay pro /board. */
  private handleRecallMessage(meetingId: string, raw: string): void {
    let parsed: { event?: string; data?: { data?: Record<string, unknown> } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // nunca derruba a conexão por uma mensagem malformada
    }
    const eventType = parsed.event;
    const inner = parsed.data?.data;
    if (!eventType || !inner) return;

    if (eventType === 'video_separate_h264.data') {
      const participant = inner.participant as { id?: number } | undefined;
      if (typeof participant?.id !== 'number' || typeof inner.buffer !== 'string') return;
      this.broadcastRecallMessage(meetingId, {
        v: BOARD_PROTOCOL_VERSION,
        type: 'recallVideo',
        participantId: participant.id,
        videoType: inner.type === 'screenshare' ? 'screenshare' : 'webcam',
        bufferB64: inner.buffer,
        at: this.now(),
      });
      return;
    }
    const mapped = RECALL_PARTICIPANT_EVENTS[eventType];
    if (mapped) {
      const participant = inner.participant as { id?: number; name?: string | null } | undefined;
      if (typeof participant?.id !== 'number') return;
      this.broadcastRecallParticipantEvent(meetingId, participant.id, participant.name ?? null, mapped);
    }
  }

  /**
   * Evento de participante do bot do Recall.ai — público porque chega por
   * DOIS caminhos: o handler interno de vídeo/eventos da WS acima, e a rota
   * de webhook HTTP (apps/web/app/api/recall-webhook), que roda fora deste
   * pacote e não tem acesso aos métodos privados.
   */
  broadcastRecallParticipantEvent(
    meetingId: string,
    participantId: number,
    name: string | null,
    event: 'join' | 'leave' | 'webcam_on' | 'webcam_off' | 'screenshare_on' | 'screenshare_off',
  ): void {
    this.broadcastRecallMessage(meetingId, {
      v: BOARD_PROTOCOL_VERSION,
      type: 'recallParticipant',
      participantId,
      name,
      event,
      at: this.now(),
    });
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

  private async onConnection(socket: WebSocket, url: string, headers: IncomingHttpHeaders): Promise<void> {
    const parsed = new URL(url, 'http://localhost');
    const pathname = parsed.pathname;

    if (pathname === '/recall-media') {
      this.onRecallConnection(socket, parsed.searchParams, headers);
      return;
    }

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
    // a reunião precisa existir e pertencer à MESMA EMPRESA do usuário autenticado
    // (não ao usuário que a criou — várias pessoas da empresa podem acompanhar a
    // mesma reunião). Autorizado se: super-admin, empresa "casa" (mesma regra de
    // fallback de `getCurrentUser`), ou membership explícita em company_member.
    const res = await this.db.query<{ id: string }>(
      `SELECT m.id FROM meeting m
       JOIN app_user u ON u.id = $2
       WHERE m.id = $1
         AND (
           u.is_super_admin = true
           OR u.company_id = m.company_id
           OR EXISTS (
             SELECT 1 FROM company_member cm
             WHERE cm.company_id = m.company_id AND cm.user_id = u.id
           )
         )`,
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
        urgency: event.contribution.urgency,
        category: event.contribution.category,
        headline: event.contribution.headline,
        recommendation: event.contribution.recommendation,
        question: event.contribution.question,
        requiresImmediateInterruption: event.contribution.requiresImmediateInterruption,
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
