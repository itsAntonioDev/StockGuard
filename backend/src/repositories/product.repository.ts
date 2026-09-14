import { Prisma, type DbClient } from '../lib/prisma.js';

export const productSummarySelect = {
  id: true,
  internalCode: true,
  barcode: true,
  name: true,
  unit: true,
  minStock: true,
  unitCost: true,
  tracksLot: true,
  tracksExpiry: true,
  handlingClass: true,
  active: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductSelect;

/** Localiza por código interno ou código de barras (leitura de scanner). */
export function findProductByCode(db: DbClient, code: string) {
  const normalized = code.trim();
  return db.product.findFirst({
    where: { OR: [{ internalCode: normalized.toUpperCase() }, { barcode: normalized }] },
    select: productSummarySelect,
  });
}

export async function stockTotalsByProduct(db: DbClient, productIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (productIds.length === 0) return new Map();
  const groups = await db.stockBalance.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { quantity: true },
  });
  return new Map(groups.map((group) => [group.productId, group._sum.quantity ?? new Prisma.Decimal(0)]));
}

/** Produtos ativos com saldo total abaixo do mínimo (mínimo > 0). */
export async function productIdsBelowMinimum(db: DbClient): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p."id"
      FROM "products" p
      LEFT JOIN "stock_balances" b ON b."productId" = p."id"
     WHERE p."active" = true AND p."minStock" > 0
     GROUP BY p."id", p."minStock"
    HAVING COALESCE(SUM(b."quantity"), 0) < p."minStock"`;
  return rows.map((row) => row.id);
}
