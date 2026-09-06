import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação de requisições do Recall.ai (Etapa "Ver participantes/tela
 * compartilhada do Meet") — webhook HTTP (apps/web/app/api/recall-webhook)
 * e upgrade do WebSocket `/recall-media` (gateway.ts) usam o MESMO esquema
 * (Svix): HMAC-SHA256 de `"${id}.${timestamp}.${payload}"` com a porção
 * base64 do `RECALL_WEBHOOK_SECRET` (prefixo `whsec_`) como chave. No
 * WebSocket o payload é sempre `null` (upgrade não tem corpo).
 * https://docs.recall.ai/docs/authenticating-requests-from-recallai
 *
 * Vive aqui (não em apps/web) porque os DOIS lados que verificam — o
 * webhook HTTP do app e o upgrade do WS do gateway — precisam do mesmo
 * código, e board-gateway já é importável por apps/web.
 *
 * NUNCA processar o evento antes desta função retornar `true` — payload não
 * verificado é tratado como potencialmente malicioso (é uma rota pública,
 * sem sessão de usuário).
 */
export interface RecallSignatureHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

/** Tolerância de idade do timestamp — proteção contra replay de requisição antiga. */
const MAX_AGE_SECONDS = 5 * 60;

export function verifyRecallRequest(
  secret: string,
  headers: RecallSignatureHeaders,
  payload: string | null,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const timestampSec = Number(headers.timestamp);
  if (!Number.isFinite(timestampSec)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSec) > MAX_AGE_SECONDS) return false;

  const secretBody = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretBody, 'base64');
  } catch {
    return false;
  }
  const signedContent = `${headers.id}.${headers.timestamp}.${payload ?? ''}`;
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected);

  // "v1,<assinatura>" espaço-separados — mais de um durante rotação do secret.
  return headers.signature
    .split(' ')
    .map((entry) => entry.split(',')[1])
    .filter((v): v is string => Boolean(v))
    .some((candidate) => {
      const candidateBuf = Buffer.from(candidate);
      return candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf);
    });
}
