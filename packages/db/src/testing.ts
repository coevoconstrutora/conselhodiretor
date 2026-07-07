import type { SqlExecutor } from './migrate';

/**
 * Superfície mínima do PGlite (dev/test) consumida por {@link pgliteExecutor}.
 * Tipada estruturalmente para NÃO acoplar `@conselho/db` a `@electric-sql/pglite`
 * (que é devDependency dos pacotes que testam, não do db em produção).
 */
export interface PgliteLike {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Adapta um PGlite ao {@link SqlExecutor}. FONTE ÚNICA — antes esta função era
 * copiada byte-a-byte em 16 arquivos de teste (+ `apps/web/lib/db.ts`); um método
 * novo no SqlExecutor ou uma mudança no mapeamento de tipos do PGlite mudava em
 * um lugar só, não em 17.
 */
export function pgliteExecutor(db: PgliteLike): SqlExecutor {
  const executor: SqlExecutor = {
    exec: async (sql: string): Promise<void> => {
      await db.exec(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await db.query<T>(text, params as unknown[]);
      return { rows: result.rows };
    },
    // PGlite é single-connection: BEGIN/COMMIT no próprio executor É atômico.
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
      await db.exec('BEGIN');
      try {
        const result = await fn(executor);
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK').then(
          () => undefined,
          () => undefined,
        );
        throw error;
      }
    },
  };
  return executor;
}
