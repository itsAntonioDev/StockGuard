import type { DiscrepancyOrigin, DiscrepancyType } from '../generated/prisma/enums.js';
import { Prisma, type DbClient } from '../lib/prisma.js';

export interface NewDiscrepancy {
  type: DiscrepancyType;
  origin: DiscrepancyOrigin;
  description: string;
  reportedById: string;
  /** Quem executou a operação relacionada — contexto de análise, não culpa. */
  operationUserId?: string | null;
  productId?: string | null;
  lotId?: string | null;
  locationId?: string | null;
  movementId?: string | null;
  movementItemId?: string | null;
  inventoryCountItemId?: string | null;
  expectedQuantity?: Prisma.Decimal | string | null;
  foundQuantity?: Prisma.Decimal | string | null;
  expectedCode?: string | null;
  foundCode?: string | null;
}

/**
 * Valor estimado = |esperado − encontrado| × custo unitário de referência.
 * Sem custo cadastrado ou sem quantidades, o valor fica nulo (não é inventado).
 */
export function estimateDiscrepancyValue(
  expected: Prisma.Decimal | string | null | undefined,
  found: Prisma.Decimal | string | null | undefined,
  unitCost: Prisma.Decimal | null | undefined,
): Prisma.Decimal | null {
  if (expected == null || found == null || unitCost == null) return null;
  return new Prisma.Decimal(expected).minus(found).abs().times(unitCost).toDecimalPlaces(2);
}

export async function createDiscrepancyRecord(db: DbClient, input: NewDiscrepancy) {
  const product = input.productId
    ? await db.product.findUnique({ where: { id: input.productId }, select: { unitCost: true } })
    : null;
  const unitCost = product?.unitCost ?? null;

  const discrepancy = await db.discrepancy.create({
    data: {
      type: input.type,
      origin: input.origin,
      description: input.description.slice(0, 2000),
      reportedById: input.reportedById,
      operationUserId: input.operationUserId ?? null,
      productId: input.productId ?? null,
      lotId: input.lotId ?? null,
      locationId: input.locationId ?? null,
      movementId: input.movementId ?? null,
      movementItemId: input.movementItemId ?? null,
      inventoryCountItemId: input.inventoryCountItemId ?? null,
      expectedQuantity: input.expectedQuantity ?? null,
      foundQuantity: input.foundQuantity ?? null,
      expectedCode: input.expectedCode?.slice(0, 64) ?? null,
      foundCode: input.foundCode?.slice(0, 64) ?? null,
      unitCostSnapshot: unitCost,
      estimatedValue: estimateDiscrepancyValue(input.expectedQuantity, input.foundQuantity, unitCost),
    },
  });
  await db.discrepancyAction.create({
    data: { discrepancyId: discrepancy.id, userId: input.reportedById, kind: 'CREATED', toStatus: 'OPEN', note: input.description.slice(0, 2000) },
  });
  return discrepancy;
}
