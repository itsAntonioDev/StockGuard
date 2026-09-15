import { NotFoundError } from '../lib/errors.js';
import { Prisma, type DbClient, type TxClient } from '../lib/prisma.js';
import type { Actor } from '../types/fastify.js';
import { toNumber } from '../utils/quantity.js';

const userRef = { select: { id: true, name: true } } as const;
const locationRef = { select: { id: true, code: true, status: true, warehouseId: true, sectorId: true, capacity: true } } as const;

export const movementDetailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: userRef,
  checkedBy: userRef,
  approvedBy: userRef,
  cancelledBy: userRef,
  items: {
    orderBy: { id: 'asc' },
    include: {
      product: { select: { id: true, internalCode: true, barcode: true, name: true, unit: true, tracksLot: true, tracksExpiry: true, unitCost: true } },
      lot: { select: { id: true, code: true, expiresAt: true } },
      fromLocation: locationRef,
      toLocation: locationRef,
    },
  },
  discrepancies: { select: { id: true, number: true, type: true, status: true, createdAt: true } },
} satisfies Prisma.StockMovementInclude;

export type MovementDetail = Prisma.StockMovementGetPayload<{ include: typeof movementDetailInclude }>;
export type MovementItemDetail = MovementDetail['items'][number];

export const movementListSelect = {
  id: true,
  number: true,
  type: true,
  status: true,
  referenceDoc: true,
  createdAt: true,
  checkStartedAt: true,
  confirmedAt: true,
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: userRef,
  checkedBy: userRef,
  _count: { select: { items: true, discrepancies: true } },
  // Primeiro item: resumo para a listagem (produto, quantidade, origem → destino).
  items: {
    take: 1,
    orderBy: { id: 'asc' },
    select: {
      expectedQuantity: true,
      quantity: true,
      unit: true,
      direction: true,
      product: { select: { id: true, internalCode: true, name: true } },
      fromLocation: { select: { code: true } },
      toLocation: { select: { code: true } },
    },
  },
} satisfies Prisma.StockMovementSelect;

/**
 * Visibilidade por perfil (aplicada em listagens E em buscas por ID — evita IDOR):
 * - movements.read.all: tudo;
 * - demais: o que criou ou conferiu, mais as filas de trabalho que pode executar.
 */
export function movementScopeWhere(actor: Actor): Prisma.StockMovementWhereInput {
  if (actor.permissions.has('movements.read.all')) return {};
  const visible: Prisma.StockMovementWhereInput[] = [{ createdById: actor.userId }, { checkedById: actor.userId }];
  if (actor.permissions.has('checks.perform')) visible.push({ status: 'PENDING_CHECK' });
  if (actor.permissions.has('movements.adjust.approve')) visible.push({ status: 'PENDING_APPROVAL' });
  return { OR: visible };
}

export async function findVisibleMovement(db: DbClient, actor: Actor, movementId: string): Promise<MovementDetail> {
  const movement = await db.stockMovement.findFirst({
    where: { AND: [{ id: movementId }, movementScopeWhere(actor)] },
    include: movementDetailInclude,
  });
  // Mesmo erro para "não existe" e "não é seu": não revela a existência do registro.
  if (!movement) throw new NotFoundError('Movimentação não encontrada.');
  return movement;
}

/** Trava a movimentação até o fim da transação e devolve o estado atual. */
export async function lockMovement(tx: TxClient, movementId: string): Promise<MovementDetail> {
  await tx.$queryRaw`SELECT 1 FROM "stock_movements" WHERE "id" = ${movementId}::uuid FOR UPDATE`;
  const movement = await tx.stockMovement.findUnique({ where: { id: movementId }, include: movementDetailInclude });
  if (!movement) throw new NotFoundError('Movimentação não encontrada.');
  return movement;
}

/** Endereço onde o item deve ser conferido: origem para saídas/transferências, destino para entradas. */
export function checkLocationOf<L>(movementType: string, item: { fromLocation: L | null; toLocation: L | null }): L | null {
  return movementType === 'ENTRY' ? item.toLocation : (item.fromLocation ?? item.toLocation);
}

export function presentMovement(movement: MovementDetail) {
  return {
    ...movement,
    items: movement.items
      .map((item) => ({
        ...item,
        expectedQuantity: toNumber(item.expectedQuantity)!,
        quantity: toNumber(item.quantity),
        product: { ...item.product, unitCost: toNumber(item.product.unitCost) },
        fromLocation: item.fromLocation ? { ...item.fromLocation, capacity: toNumber(item.fromLocation.capacity) } : null,
        toLocation: item.toLocation ? { ...item.toLocation, capacity: toNumber(item.toLocation.capacity) } : null,
      }))
      // Ordem de percurso: facilita a separação pelo operador.
      .sort((a, b) => (checkLocationOf(movement.type, a)?.code ?? '').localeCompare(checkLocationOf(movement.type, b)?.code ?? '')),
  };
}
