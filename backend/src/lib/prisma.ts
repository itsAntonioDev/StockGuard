import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { getEnv, type Env } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export { Prisma };

/** Cliente dentro de uma transação interativa. */
export type TxClient = Prisma.TransactionClient;
/** Qualquer cliente capaz de executar consultas (raiz ou transação). */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/** Parâmetros usados só pelo Prisma CLI (schema, sslmode) saem da URL: o driver recebe configuração explícita. */
function driverConnectionString(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('schema');
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

function sslConfig(env: Env): pg.PoolConfig['ssl'] {
  switch (env.DATABASE_SSL) {
    case 'disable':
      return false;
    case 'require':
      // Tráfego cifrado sem validar a identidade do servidor — bloqueado em produção (env.ts).
      return { rejectUnauthorized: false };
    case 'verify':
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho definido pelo operador na configuração, não por usuários
      return { rejectUnauthorized: true, ...(env.DATABASE_CA_CERT_PATH ? { ca: readFileSync(env.DATABASE_CA_CERT_PATH, 'utf8') } : {}) };
  }
}

export interface Database {
  prisma: PrismaClient;
  close: () => Promise<void>;
}

/**
 * Pool próprio com o schema no search_path de cada conexão: consultas SQL
 * diretas e triggers resolvem as tabelas no schema certo (public ou stockguard).
 */
export function createDatabase(connectionString: string, env: Env = getEnv()): Database {
  const schema = env.DATABASE_SCHEMA;
  const pool = new pg.Pool({
    connectionString: driverConnectionString(connectionString),
    ssl: sslConfig(env),
    max: 10,
    // Banco remoto (ex.: Supabase em outra região): conexão TLS inicial pode levar alguns segundos.
    connectionTimeoutMillis: 10_000,
  });
  pool.on('connect', (client) => {
    // O nome do schema é validado no env (apenas [a-z0-9_]).
    client.query(`SET search_path TO "${schema}"`).catch((error: unknown) => pool.emit('error', error, client));
  });
  pool.on('error', (error) => process.emitWarning(`Erro no pool do PostgreSQL: ${error.message}`));

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
    // Padrão do Prisma é 2 s para obter conexão; insuficiente na primeira conexão com banco distante.
    transactionOptions: { maxWait: 10_000 },
  });
  return {
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

let database: Database | undefined;

export function getPrisma(): PrismaClient {
  database ??= createDatabase(getEnv().DATABASE_URL);
  return database.prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (database) {
    const current = database;
    database = undefined;
    await current.close();
  }
}
