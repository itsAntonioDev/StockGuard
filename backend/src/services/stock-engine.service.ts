import { BusinessRuleError, ConflictError } from '../lib/errors.js';
import { Prisma, type DbClient, type TxClient } from '../lib/prisma.js';
import { databaseErrorText } from '../lib/transaction.js';

/**
 * Motor de estoque: única camada da API que altera saldos, sempre dentro de
 * uma transação e sempre pela função sg_apply_stock_delta do banco.
 */
export interface StockDelta {
  movementItemId: string;
  productId: string;
  locationId: string;
  lotId: string | null;
  /** Positivo = entrada no endereço; negativo = saída. */
  delta: Prisma.Decimal;
}

export class StockEngineError extends BusinessRuleError {
  constructor(code: string, message: string, readonly delta: StockDelta) {
    super(code, message, { productId: delta.productId, locationId: delta.locationId, lotId: delta.lotId });
  }
}

function mapEngineError(error: unknown, delta: StockDelta): Error {
  const text = databaseErrorText(error);
  if (text.includes('SG_INSUFFICIENT_STOCK')) {
    return new StockEngineError(
      'INSUFFICIENT_STOCK',
      'Estoque insuficiente no endereço no momento da confirmação. Outra operação pode ter consumido o saldo — atualize e confira novamente.',
      delta,
    );
  }
  if (text.includes('SG_MOVEMENT_NOT_PENDING') || text.includes('SG_IMMUTABLE_MOVEMENT')) {
    return new ConflictError('Esta movimentação já foi processada por outra operação.', 'MOVEMENT_ALREADY_PROCESSED');
  }
  if (text.includes('stock_ledger_entries_item_direction_key')) {
    return new ConflictError('Este item já foi aplicado ao estoque.', 'MOVEMENT_ALREADY_PROCESSED');
  }
  if (/SG_(DELTA_MISMATCH|LOCATION_MISMATCH|ITEM_NOT_FOUND|INVALID_DELTA)/u.test(text)) {
    // Indica bug ou tentativa de manipulação — nunca deve ocorrer em fluxo normal.
    return new BusinessRuleError('STOCK_INTEGRITY_VIOLATION', 'Operação de estoque inconsistente foi bloqueada.');
  }
  return error instanceof Error ? error : new Error('Falha ao aplicar movimentação de estoque.');
}

/**
 * Aplica os lançamentos em ordem determinística (endereço, produto, lote, saídas antes
 * de entradas). Ordem fixa de travamento reduz deadlocks entre operações concorrentes.
 */
export async function applyStockDeltas(tx: TxClient, deltas: StockDelta[], actorId: string): Promise<void> {
  const ordered = [...deltas].sort(
    (a, b) =>
      a.locationId.localeCompare(b.locationId) ||
      a.productId.localeCompare(b.productId) ||
      (a.lotId ?? '').localeCompare(b.lotId ?? '') ||
      a.delta.comparedTo(b.delta),
  );

  for (const item of ordered) {
    try {
      await tx.$queryRaw`
        SELECT sg_apply_stock_delta(
          ${item.movementItemId}::uuid,
          ${item.locationId}::uuid,
          ${item.delta.toString()}::numeric,
          ${actorId}::uuid
        ) AS "balanceAfter"`;
    } catch (error) {
      throw mapEngineError(error, item);
    }
  }
}

/** Saldo disponível num endereço (lote nulo = produto sem controle de lote). */
export async function getAvailableQuantity(db: DbClient, productId: string, locationId: string, lotId: string | null): Promise<Prisma.Decimal> {
  const balance = await db.stockBalance.findFirst({
    where: { productId, locationId, lotId },
    select: { quantity: true },
  });
  return balance?.quantity ?? new Prisma.Decimal(0);
}

/** Saldo total do produto (todos os endereços e lotes). */
export async function getProductTotal(db: DbClient, productId: string): Promise<Prisma.Decimal> {
  const result = await db.stockBalance.aggregate({ where: { productId }, _sum: { quantity: true } });
  return result._sum.quantity ?? new Prisma.Decimal(0);
}
