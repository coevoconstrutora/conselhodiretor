import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@conselho/db';
import { createSession } from '@conselho/auth';
import { createMeeting } from '@conselho/meetings';
import type { BoardContributionEvent } from '@conselho/board';
import type { BoardServerMessage } from '@conselho/shared-types';
import { BoardGateway } from './gateway';


/** Fonte de eventos controlável com a MESMA superfície de subscribe do orchestrator. */
type Listener = (event: BoardContributionEvent) => void;
function makeEventSource() {
  const listeners = new Set<Listener>();
  return {
    orchestrator: {
      subscribe(listener: Listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emit(event: BoardContributionEvent) {
      listeners.forEach((l) => l(event));
    },
  };
}

function contributionEvent(meetingId: string, id = 'evt-1'): BoardContributionEvent {
  return {
    type: 'contribution',
    id,
    meetingId,
    triggeredBy: 'legal-risco-grave',
    at: 123,
    contribution: {
      agentId: 'legal',
      type: 'atencao',
      severity: 'critical',
      text: 'Vale mapear o risco jurídico e provisionar.',
      relevanceScore: 0.9,
    },
  };
}

function connect(port: number, query: string): Promise<{ ws: WebSocket; closeCode?: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/board?${query}`);
    ws.on('open', () => resolve({ ws }));
    ws.on('close', (code) => resolve({ ws, closeCode: code }));
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<BoardServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data)) as BoardServerMessage));
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

describe('BoardGateway (Story 3.2 — ADR-003)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let gateway: BoardGateway;
  let token: string;
  let meetingId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
    const companyId = company.rows[0]!.id;
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['nutro@conselho.test', 'Dra. Ana', 'x', companyId],
    );
    const userId = res.rows[0]!.id;
    token = (await createSession(exec, userId)).token;
    meetingId = await createMeeting(exec, userId, companyId, 'Reunião', randomBytes(32));
    gateway = new BoardGateway(exec, { port: 0, heartbeatMs: 60_000 });
  });

  afterAll(async () => {
    await gateway.close();
    await db.close();
  });

  it('AC1 — rejeita conexão sem token (4400) e com token inválido (4401)', async () => {
    const noToken = new WebSocket(`ws://127.0.0.1:${gateway.port}/board?meetingId=x`);
    expect(await waitClose(noToken)).toBe(4400);

    const badToken = new WebSocket(
      `ws://127.0.0.1:${gateway.port}/board?meetingId=${meetingId}&token=invalido`,
    );
    expect(await waitClose(badToken)).toBe(4401);
  });

  it('AC1 — rejeita consulta inexistente/de outro usuário (4403)', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${gateway.port}/board?meetingId=00000000-0000-0000-0000-000000000000&token=${token}`,
    );
    expect(await waitClose(ws)).toBe(4403);
  });

  it('AC2/AC5 — evento do orchestrator chega ao cliente como mensagem tipada v1', async () => {
    const source = makeEventSource();
    gateway.bind(meetingId, source.orchestrator);

    const { ws } = await connect(gateway.port, `meetingId=${meetingId}&token=${token}`);
    const received = nextMessage(ws);
    source.emit(contributionEvent(meetingId));

    const message = await received;
    expect(message).toMatchObject({
      v: 1,
      type: 'contribution',
      id: 'evt-1',
      meetingId,
      triggeredBy: 'legal-risco-grave',
      contribution: { agentId: 'legal', severity: 'critical', text: 'Vale mapear o risco jurídico e provisionar.' },
    });
    ws.close();
  });

  it('AC2 — evento de OUTRA consulta não vaza para este cliente', async () => {
    const source = makeEventSource();
    gateway.bind(meetingId, source.orchestrator);
    const { ws } = await connect(gateway.port, `meetingId=${meetingId}&token=${token}`);

    const messages: BoardServerMessage[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(String(d)) as BoardServerMessage));

    source.emit(contributionEvent('outra-consulta', 'evt-vazado'));
    source.emit(contributionEvent(meetingId, 'evt-meu'));
    await new Promise((r) => setTimeout(r, 50));

    expect(messages.map((m) => (m.type === 'contribution' ? m.id : ''))).toEqual(['evt-meu']);
    ws.close();
  });

  it('A3 — broadcastStatus chega ao cliente conectado', async () => {
    const { ws } = await connect(gateway.port, `meetingId=${meetingId}&token=${token}`);
    const received = nextMessage(ws);
    gateway.broadcastStatus(meetingId, 'degraded', 1234);
    expect(await received).toMatchObject({ v: 1, type: 'status', stt: 'degraded', lastFinalAt: 1234 });
    ws.close();
  });

  it('A3 — cliente que conecta DEPOIS recebe o último status (replay)', async () => {
    gateway.broadcastStatus(meetingId, 'live', 5678);
    // listener ANTES do open: o replay pode chegar no mesmo flush do handshake
    const ws = new WebSocket(
      `ws://127.0.0.1:${gateway.port}/board?meetingId=${meetingId}&token=${token}`,
    );
    const received = nextMessage(ws);
    const message = await received;
    expect(message).toMatchObject({ v: 1, type: 'status', stt: 'live', lastFinalAt: 5678 });
    ws.close();
  });

  it('A6 — modo detached: upgrade roteado por server HTTP externo completa o handshake (auth igual)', async () => {
    const detached = new BoardGateway(exec, { detached: true, heartbeatMs: 60_000 });
    const http = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    http.on('upgrade', (req, socket, head) => detached.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as AddressInfo).port;

    // auth continua valendo no modo detached
    const bad = new WebSocket(`ws://127.0.0.1:${port}/board?meetingId=${meetingId}&token=invalido`);
    expect(await waitClose(bad)).toBe(4401);

    const source = makeEventSource();
    detached.bind(meetingId, source.orchestrator);
    const { ws } = await connect(port, `meetingId=${meetingId}&token=${token}`);
    const received = nextMessage(ws);
    source.emit(contributionEvent(meetingId, 'evt-detached'));
    expect(await received).toMatchObject({ v: 1, type: 'contribution', id: 'evt-detached' });

    ws.close();
    await detached.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it('AC4 — heartbeat ping chega ao cliente conectado', async () => {
    const fast = new BoardGateway(exec, { port: 0, heartbeatMs: 30, now: () => 999 });
    const { ws } = await connect(fast.port, `meetingId=${meetingId}&token=${token}`);
    const message = await nextMessage(ws);
    expect(message).toMatchObject({ v: 1, type: 'ping', at: 999 });
    ws.close();
    await fast.close();
  });
});
