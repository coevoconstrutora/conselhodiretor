import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyRecallRequest } from './recall-verify';

// Mesmo exemplo da documentação do Svix (esquema usado pelo Recall.ai).
const SECRET = 'whsec_5WbX5kEWLlfzsGNjH64I8lOOqUB6e8FH';

function sign(id: string, timestamp: string, payload: string | null): string {
  const secretBytes = Buffer.from(SECRET.split('_')[1]!, 'base64');
  const signedContent = `${id}.${timestamp}.${payload ?? ''}`;
  return `v1,${createHmac('sha256', secretBytes).update(signedContent).digest('base64')}`;
}

describe('verifyRecallRequest — autenticação de webhook/websocket do Recall.ai', () => {
  it('assinatura válida (webhook com corpo) ⇒ true', () => {
    const id = 'msg_123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = '{"event":"participant_events.join"}';
    const signature = sign(id, timestamp, payload);
    expect(verifyRecallRequest(SECRET, { id, timestamp, signature }, payload)).toBe(true);
  });

  it('assinatura válida (upgrade de WebSocket, payload null) ⇒ true', () => {
    const id = 'msg_456';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(id, timestamp, null);
    expect(verifyRecallRequest(SECRET, { id, timestamp, signature }, null)).toBe(true);
  });

  it('corpo alterado depois de assinado ⇒ false', () => {
    const id = 'msg_789';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(id, timestamp, '{"a":1}');
    expect(verifyRecallRequest(SECRET, { id, timestamp, signature }, '{"a":2}')).toBe(false);
  });

  it('secret errado ⇒ false', () => {
    const id = 'msg_1';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(id, timestamp, 'x');
    expect(
      verifyRecallRequest(
        'whsec_' + Buffer.from('outro-secret').toString('base64'),
        { id, timestamp, signature },
        'x',
      ),
    ).toBe(false);
  });

  it('timestamp fora da janela de tolerância (replay) ⇒ false', () => {
    const id = 'msg_2';
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1h atrás
    const signature = sign(id, oldTimestamp, 'x');
    expect(verifyRecallRequest(SECRET, { id, timestamp: oldTimestamp, signature }, 'x')).toBe(false);
  });

  it('headers ausentes ⇒ false, nunca lança', () => {
    expect(verifyRecallRequest(SECRET, { id: null, timestamp: null, signature: null }, null)).toBe(false);
  });

  it('aceita quando UMA das assinaturas espaço-separadas bate (rotação de secret)', () => {
    const id = 'msg_3';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const real = sign(id, timestamp, 'x');
    const fake = 'v1,QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ=';
    expect(verifyRecallRequest(SECRET, { id, timestamp, signature: `${fake} ${real}` }, 'x')).toBe(true);
  });
});
