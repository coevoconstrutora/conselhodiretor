/**
 * Configuração de conexão Postgres com TLS obrigatório em trânsito (NFR9 / AC4).
 *
 * Conexões remotas DEVEM usar TLS: forçamos `ssl.rejectUnauthorized = true` e
 * proibimos explicitamente `sslmode=disable`. Conexões locais (localhost) são
 * isentas para desenvolvimento. A verificação ao-vivo de "recusa sem TLS" exige
 * um servidor real e fica para o ambiente de deploy/POC; aqui validamos a
 * configuração de forma determinística (verificação equivalente — AC4).
 */

export interface PgConnectionConfig {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

export function buildPgConfig(connectionString: string): PgConnectionConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL inválida: não é uma URL de conexão Postgres válida.');
  }

  const host = url.hostname;
  const sslmode = url.searchParams.get('sslmode');

  if (isLocalHost(host)) {
    return { connectionString };
  }

  if (sslmode === 'disable') {
    throw new Error(
      'Conexão remota com sslmode=disable é proibida (NFR9: criptografia em trânsito obrigatória).',
    );
  }

  return { connectionString, ssl: { rejectUnauthorized: true } };
}

/** Constrói a config a partir do ambiente (`DATABASE_URL`). */
export function buildPgConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PgConnectionConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL ausente — configure a string de conexão Postgres.');
  }
  return buildPgConfig(connectionString);
}
