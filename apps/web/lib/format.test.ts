import { describe, it, expect } from 'vitest';
import { startOfTodayBR } from './format';

describe('startOfTodayBR', () => {
  it('à tarde em Brasília, devolve 00:00 BRT (03:00 UTC) do mesmo dia', () => {
    expect(startOfTodayBR(new Date('2026-11-10T16:10:00Z')).toISOString()).toBe('2026-11-10T03:00:00.000Z');
  });
  it('logo após a meia-noite UTC ainda é "ontem" em Brasília', () => {
    expect(startOfTodayBR(new Date('2026-11-11T01:30:00Z')).toISOString()).toBe('2026-11-10T03:00:00.000Z');
  });
});
