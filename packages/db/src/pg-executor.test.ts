import { describe, it, expect, vi } from 'vitest';
import { attachPoolErrorHandler, createPool } from './pg-executor';

describe('pool do pg — conexão ociosa derrubada pelo servidor', () => {
  it('createPool registra handler de erro: o erro do pool não vira exceção não tratada', async () => {
    const pool = createPool({ DATABASE_URL: 'postgres://u:p@localhost:5432/x' });
    try {
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
      const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
      expect(silenced).toHaveBeenCalledOnce();
      silenced.mockRestore();
    } finally {
      await pool.end();
    }
  });

  it('createPool aplica limites de pool (timeout de conexão cobre cold start)', async () => {
    const pool = createPool({ DATABASE_URL: 'postgres://u:p@localhost:5432/x' });
    try {
      expect(pool.options.max).toBe(8);
      expect(pool.options.idleTimeoutMillis).toBe(30_000);
      expect(pool.options.connectionTimeoutMillis).toBe(15_000);
    } finally {
      await pool.end();
    }
  });

  it('sem o handler o mesmo emit lançaria — é ele que protege o processo', async () => {
    const { Pool } = await import('pg');
    const bare = new Pool({ connectionString: 'postgres://u:p@localhost:5432/x' });
    try {
      expect(() => bare.emit('error', new Error('boom'))).toThrow('boom');
      attachPoolErrorHandler(bare, () => {});
      expect(() => bare.emit('error', new Error('boom'))).not.toThrow();
    } finally {
      await bare.end();
    }
  });
});
