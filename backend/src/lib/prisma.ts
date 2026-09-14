import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export { Prisma };

/** Cliente dentro de uma transação interativa. */
export type TxClient = Prisma.TransactionClient;
/** Qualquer cliente capaz de executar consultas (raiz ou transação). */
export type DbClient = PrismaClient | Prisma.TransactionClient;

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL, max: 10 });
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
