import { setTimeout as sleep } from 'node:timers/promises';
import { getPrisma, Prisma, type TxClient } from './prisma.js';

/** Junta mensagem, metadados e causa de um erro do banco para inspeção. */
export function databaseErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) parts.push(current.message);
    if (typeof current === 'object' && current !== null) {
      const record = current as { meta?: unknown; code?: unknown; cause?: unknown };
      if (record.meta) parts.push(JSON.stringify(record.meta));
      if (typeof record.code === 'string') parts.push(record.code);
      current = record.cause;
    } else {
      break;
    }
  }
  return parts.join(' | ');
}

/** Deadlock (40P01) ou falha de serialização (40001): seguro repetir a transação inteira. */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
  const text = databaseErrorText(error);
  return /40P01|40001|deadlock detected|could not serialize/iu.test(text);
}

export interface TransactionOptions {
  maxAttempts?: number;
  timeoutMs?: number;
}

/**
 * Transação interativa com repetição automática em conflitos de concorrência.
 * A função precisa ser idempotente em relação a efeitos externos ao banco.
 */
export async function runTransaction<T>(fn: (tx: TxClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getPrisma().$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: options.timeoutMs ?? 15_000,
      });
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableTransactionError(error)) throw error;
      await sleep(25 * attempt + Math.floor(Math.random() * 50));
    }
  }
}
