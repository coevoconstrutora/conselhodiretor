/**
 * Custom server de PRODUÇÃO (A6 — WS na mesma porta do HTTP).
 *
 * Por quê: redes restritivas de clínica/hospital bloqueiam portas fora de 443.
 * Este server serve o Next E roteia os upgrades de WebSocket de /board e /audio
 * para o BoardGateway (modo detached), tudo pela porta do [http_service] do Fly.
 *
 * Handshake via globalThis.__conselhoBoardUpgrade: este arquivo é JS puro fora
 * do bundle do Next — não pode importar board-runtime (TS + `server-only`).
 * O board-runtime registra o handler no warm-up (instrumentation.ts).
 *
 * Ativação: BOARD_WS_MODE=attached (Dockerfile). Rollback: voltar o CMD para
 * `next start` — dev local segue com `next dev` + gateway na 3001.
 */
import { createServer } from 'node:http';
import next from 'next';

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev, hostname, port });
await app.prepare(); // roda instrumentation.ts → warm-up do board runtime

const handle = app.getRequestHandler();
const nextUpgrade = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null;

const server = createServer((req, res) => handle(req, res));

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const boardUpgrade = globalThis.__conselhoBoardUpgrade;
  if ((pathname === '/board' || pathname === '/audio') && typeof boardUpgrade === 'function') {
    boardUpgrade(req, socket, head);
    return;
  }
  if (nextUpgrade) {
    // passthrough do Next (HMR em dev; inócuo em prod)
    void nextUpgrade(req, socket, head);
    return;
  }
  socket.destroy(); // upgrade desconhecido sem handler do Next — encerra limpo
});

server.listen(port, hostname, () => {
  console.log(`[server] Next + WS do board em http://${hostname}:${port} (BOARD_WS_MODE=${process.env.BOARD_WS_MODE ?? 'port'})`);
});
