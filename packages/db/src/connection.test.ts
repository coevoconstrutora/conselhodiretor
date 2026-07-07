import { describe, it, expect } from 'vitest';
import { buildPgConfig, buildPgConfigFromEnv, isLocalHost } from './connection';

describe('buildPgConfig — TLS obrigatório em trânsito (NFR9 / AC4)', () => {
  it('não exige SSL para conexões locais', () => {
    const cfg = buildPgConfig('postgres://user:pass@localhost:5432/nutrimed');
    expect(cfg.ssl).toBeUndefined();
  });

  it('força SSL (rejectUnauthorized) para hosts remotos', () => {
    const cfg = buildPgConfig('postgres://user:pass@db.example.com:5432/nutrimed');
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('proíbe sslmode=disable em conexão remota', () => {
    expect(() =>
      buildPgConfig('postgres://user:pass@db.example.com:5432/nutrimed?sslmode=disable'),
    ).toThrow(/sslmode=disable/);
  });

  it('aceita sslmode=require em conexão remota', () => {
    const cfg = buildPgConfig('postgres://user:pass@db.example.com:5432/nutrimed?sslmode=require');
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('rejeita DATABASE_URL malformada', () => {
    expect(() => buildPgConfig('não-é-url')).toThrow(/inválida/);
  });

  it('buildPgConfigFromEnv exige DATABASE_URL', () => {
    expect(() => buildPgConfigFromEnv({})).toThrow(/ausente/);
  });

  it('isLocalHost reconhece hosts locais', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('db.example.com')).toBe(false);
  });
});
