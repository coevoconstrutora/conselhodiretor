/**
 * Base do WebSocket do board (A6). wsBaseUrl vazio ⇒ MESMA ORIGEM da página
 * (wss:// em HTTPS): é o modo attached, tudo pela 443 — funciona em redes de
 * clínica que bloqueiam portas altas.
 */
export function resolveWsBase(wsBaseUrl: string | undefined): string {
  if (wsBaseUrl) return wsBaseUrl;
  if (typeof location === 'undefined') return 'ws://localhost:3001';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}
