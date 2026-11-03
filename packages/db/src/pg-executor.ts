import { Pool, type PoolClient } from 'pg';
import { buildPgConfigFromEnv } from './connection';
import type { SqlExecutor } from './migrate';

/**
 * Executor baseado no driver `pg` para Postgres real (produção).
 * Usa o protocolo de query simples para `exec` (permite múltiplos statements
 * em migrations), e queries parametrizadas (`$1..`) para chamadas com argumentos.
 */

function clientExecutor(client: PoolClient): SqlExecutor {
  return {
    exec: async (sql: string): Promise<void> => {
      await client.query(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await client.query(text, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    // transação aninhada: já estamos numa conexão única — roda direto
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
      fn(clientExecutor(client)),
  };
}

export function pgExecutor(pool: Pool): SqlExecutor {
  return {
    exec: async (sql: string): Promise<void> => {
      await pool.query(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await pool.query(text, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    /**
     * Atomicidade REAL sobre Pool: pega um client dedicado, roda BEGIN/COMMIT
     * na MESMA conexão física, e devolve o client sempre — mesmo em erro.
     */
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(clientExecutor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Limites do Pool. Instância única do app → pool pequeno. `connectionTimeoutMillis`
 * folgado cobre o cold start de um banco que suspende por ociosidade (Neon ~0,5–1 s;
 * VPS/MPG nunca chegam perto). Idle curto descarta cedo conexões que o servidor
 * costuma derrubar; keepAlive detecta socket morto.
 */
const POOL_LIMITS = {
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
} as const;

/**
 * Sem listener de `'error'`, o `pg` re-emite o erro de uma conexão OCIOSA derrubada
 * pelo servidor (suspend do banco, restart, failover) como exceção não tratada e
 * derruba o processo Node — junto com as reuniões ao vivo. O client defeituoso já
 * é removido do pool; a próxima query abre outro.
 */
export function attachPoolErrorHandler(
  pool: Pool,
  log: (message: string, error: unknown) => void = (message, error) => console.error(message, error),
): void {
  pool.on('error', (error) => {
    log('[db] conexão ociosa do pool falhou (descartada; a próxima query reconecta):', error);
  });
}

/** Cria um Pool `pg` com TLS obrigatório em trânsito, a partir do ambiente. */
export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const pool = new Pool({ ...POOL_LIMITS, ...buildPgConfigFromEnv(env) });
  attachPoolErrorHandler(pool);
  return pool;
}
