// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resolveWsBase } from './ws-url';

describe('resolveWsBase (A6 — WS pela mesma origem)', () => {
  it('URL explícita vence', () => {
    expect(resolveWsBase('wss://nutrimed.fly.dev:3001')).toBe('wss://nutrimed.fly.dev:3001');
  });

  it('vazio → deriva da origem da página (ws em http)', () => {
    // jsdom roda em http://localhost:3000 por default do vitest
    expect(resolveWsBase('')).toBe(`ws://${location.host}`);
    expect(resolveWsBase(undefined)).toBe(`ws://${location.host}`);
  });
});
