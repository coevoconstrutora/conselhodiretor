import { MIGRATIONS } from './migrations';

/**
 * Executor SQL mínimo — abstrai o driver concreto para que as MESMAS migrations
 * rodem em Postgres real (driver `pg`, produção) e em PGlite (in-process: testes
 * sem Docker e dev local). É o que torna schema/criptografia verificáveis (AC2/AC3).
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /**
   * Executa `fn` numa transação ATÔMICA sobre uma ÚNICA conexão.
   * Obrigatório para escrita clínica + auditoria (auditedClinicalWrite): num
   * Pool multi-conexão do `pg`, BEGIN/COMMIT soltos não garantem a mesma
   * conexão física — este método é a única forma segura. Implementações:
   * PGlite (single-connection) usa BEGIN/COMMIT direto; `pg` faz
   * pool.connect() e roda tudo no mesmo client.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/**
 * Aplica as migrations pendentes (em ordem), rastreando as aplicadas em `_migrations`.
 * Idempotente: reexecutar não reaplica nada (AC3). Retorna os nomes aplicados nesta chamada.
 */
export async function runMigrations(db: SqlExecutor): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     );`,
  );

  const appliedResult = await db.query<{ name: string }>('SELECT name FROM _migrations');
  const applied = new Set(appliedResult.rows.map((r) => r.name));

  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    await db.exec(migration.sql);
    await db.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
    ran.push(migration.name);
  }
  return ran;
}
