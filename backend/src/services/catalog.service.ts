import { BusinessRuleError, ConflictError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma, type DbClient } from '../lib/prisma.js';
import { findProductByCode, productIdsBelowMinimum, productSummarySelect, stockTotalsByProduct } from '../repositories/product.repository.js';
import { diffFields } from '../utils/diff.js';
import { toNumber } from '../utils/quantity.js';
import type { RequestContext } from '../utils/request-context.js';
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  HistoryQuery,
  LotCreateInput,
  ProductCreateInput,
  ProductListQuery,
  ProductUpdateInput,
} from '../validators/catalog.schemas.js';
import { skipTake, toPage } from '../validators/common.js';
import { evaluateLowStock } from './alert.service.js';
import { writeAudit } from './audit.service.js';

type ProductSummary = Prisma.ProductGetPayload<{ select: typeof productSummarySelect }>;

function presentProduct(product: ProductSummary, total: Prisma.Decimal = new Prisma.Decimal(0)) {
  return {
    ...product,
    minStock: toNumber(product.minStock)!,
    unitCost: toNumber(product.unitCost),
    stockTotal: toNumber(total)!,
    belowMinimum: product.minStock.gt(0) && total.lt(product.minStock),
  };
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

export async function listProducts(query: ProductListQuery) {
  const prisma = getPrisma();
  const where: Prisma.ProductWhereInput = {};
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { internalCode: { contains: query.search.toUpperCase() } },
      { barcode: query.search },
    ];
  }
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.active) where.active = query.active === 'true';
  if (query.belowMinimum === 'true') where.id = { in: await productIdsBelowMinimum(prisma) };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, select: productSummarySelect, orderBy: { name: 'asc' }, ...skipTake(query.page, query.pageSize) }),
  ]);
  const totals = await stockTotalsByProduct(prisma, products.map((product) => product.id));
  return toPage(products.map((product) => presentProduct(product, totals.get(product.id))), total, query.page, query.pageSize);
}

export async function getProduct(productId: string) {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { ...productSummarySelect, description: true, createdAt: true },
  });
  if (!product) throw new NotFoundError('Produto não encontrado.');

  const [balances, lots] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { productId, quantity: { gt: 0 } },
      orderBy: { location: { code: 'asc' } },
      select: {
        quantity: true,
        updatedAt: true,
        lot: { select: { id: true, code: true, expiresAt: true } },
        location: { select: { id: true, code: true, status: true, sector: { select: { id: true, code: true, name: true } } } },
      },
    }),
    prisma.lot.findMany({ where: { productId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const total = balances.reduce((sum, balance) => sum.plus(balance.quantity), new Prisma.Decimal(0));

  return {
    ...presentProduct(product, total),
    description: product.description,
    createdAt: product.createdAt,
    balances: balances.map((balance) => ({ ...balance, quantity: toNumber(balance.quantity)! })),
    lots,
  };
}

/** Identificação por leitura de código (scanner/digitação) — usada na conferência. */
export async function lookupProduct(code: string) {
  const prisma = getPrisma();
  const product = await findProductByCode(prisma, code);
  if (!product) throw new NotFoundError(`Nenhum produto encontrado para o código "${code.slice(0, 64)}".`);
  const totals = await stockTotalsByProduct(prisma, [product.id]);
  return presentProduct(product, totals.get(product.id));
}

async function assertCategoryUsable(db: DbClient, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { active: true } });
  if (!category) throw new BusinessRuleError('CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
  if (!category.active) throw new BusinessRuleError('CATEGORY_INACTIVE', 'A categoria está inativa.');
}

export async function createProduct(input: ProductCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await assertCategoryUsable(tx, input.categoryId);
    const duplicate = await tx.product.findFirst({
      where: { OR: [{ internalCode: input.internalCode }, ...(input.barcode ? [{ barcode: input.barcode }] : [])] },
      select: { internalCode: true },
    });
    if (duplicate) {
      throw new ConflictError(
        duplicate.internalCode === input.internalCode ? 'Já existe um produto com este código interno.' : 'Já existe um produto com este código de barras.',
        'PRODUCT_DUPLICATE',
      );
    }

    const product = await tx.product.create({ data: input, select: productSummarySelect });
    await writeAudit(tx, context, { action: 'products.create', result: 'SUCCESS', entityType: 'Product', entityId: product.id, metadata: { after: input } });
    return presentProduct(product);
  });
}

export async function updateProduct(productId: string, input: ProductUpdateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id: productId } });
    if (!current) throw new NotFoundError('Produto não encontrado.');
    await assertCategoryUsable(tx, input.categoryId);

    const tracksLot = input.tracksLot ?? current.tracksLot;
    const tracksExpiry = input.tracksExpiry ?? current.tracksExpiry;
    if (tracksExpiry && !tracksLot) {
      throw new BusinessRuleError('EXPIRY_REQUIRES_LOT', 'Controle de validade exige controle de lote.');
    }

    // Mudar unidade ou controle de lote com saldo/operações abertas corromperia o histórico.
    const structuralChange =
      (input.unit !== undefined && input.unit !== current.unit) || (input.tracksLot !== undefined && input.tracksLot !== current.tracksLot);
    if (structuralChange) {
      const [balance, pending] = await Promise.all([
        tx.stockBalance.findFirst({ where: { productId, quantity: { gt: 0 } }, select: { id: true } }),
        tx.stockMovementItem.findFirst({
          where: { productId, movement: { status: { in: ['PENDING_CHECK', 'PENDING_APPROVAL'] } } },
          select: { id: true },
        }),
      ]);
      if (balance || pending) {
        throw new BusinessRuleError(
          'PRODUCT_HAS_STOCK',
          'Não é possível alterar unidade de medida ou controle de lote de um produto com saldo ou operações pendentes.',
        );
      }
    }

    if (input.active === false) {
      const pending = await tx.stockMovementItem.findFirst({
        where: { productId, movement: { status: { in: ['PENDING_CHECK', 'PENDING_APPROVAL'] } } },
        select: { id: true },
      });
      if (pending) throw new BusinessRuleError('PRODUCT_HAS_PENDING_OPERATIONS', 'Conclua ou cancele as operações pendentes antes de inativar o produto.');
    }

    if (input.barcode) {
      const duplicate = await tx.product.findFirst({ where: { barcode: input.barcode, id: { not: productId } }, select: { id: true } });
      if (duplicate) throw new ConflictError('Já existe um produto com este código de barras.', 'PRODUCT_DUPLICATE');
    }

    const changes = diffFields(current as unknown as Record<string, unknown>, input as Record<string, unknown>);
    const product = await tx.product.update({
      where: { id: productId },
      data: { ...input, barcode: input.barcode === '' ? null : input.barcode },
      select: productSummarySelect,
    });
    await writeAudit(tx, context, { action: 'products.update', result: 'SUCCESS', entityType: 'Product', entityId: productId, metadata: { changes } });
    // Novo mínimo pode abrir ou resolver o alerta de estoque baixo imediatamente.
    if (input.minStock !== undefined) await evaluateLowStock(tx, [productId]);
    const totals = await stockTotalsByProduct(tx, [productId]);
    return presentProduct(product, totals.get(productId));
  });
}

/** Histórico de movimentações do produto, a partir do ledger (fonte da verdade). */
export async function listProductHistory(productId: string, query: HistoryQuery) {
  const prisma = getPrisma();
  const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!exists) throw new NotFoundError('Produto não encontrado.');

  const where: Prisma.StockLedgerEntryWhereInput = { productId, ...(query.locationId ? { locationId: query.locationId } : {}) };
  const [total, entries] = await Promise.all([
    prisma.stockLedgerEntry.count({ where }),
    prisma.stockLedgerEntry.findMany({
      where,
      orderBy: { id: 'desc' },
      ...skipTake(query.page, query.pageSize),
      select: {
        id: true,
        delta: true,
        balanceAfter: true,
        createdAt: true,
        location: { select: { id: true, code: true } },
        lot: { select: { id: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        movement: { select: { id: true, number: true, type: true, reason: true, referenceDoc: true } },
      },
    }),
  ]);
  const items = entries.map((entry) => ({
    ...entry,
    id: entry.id.toString(),
    delta: toNumber(entry.delta)!,
    balanceAfter: toNumber(entry.balanceAfter)!,
  }));
  return toPage(items, total, query.page, query.pageSize);
}

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

export async function createLot(productId: string, input: LotCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { tracksLot: true, tracksExpiry: true, active: true } });
    if (!product) throw new NotFoundError('Produto não encontrado.');
    if (!product.tracksLot) throw new BusinessRuleError('PRODUCT_WITHOUT_LOT_CONTROL', 'Este produto não controla lote.');
    if (product.tracksExpiry && !input.expiresAt) throw new BusinessRuleError('LOT_EXPIRY_REQUIRED', 'Informe a validade do lote.');

    const existing = await tx.lot.findUnique({ where: { productId_code: { productId, code: input.code } }, select: { id: true } });
    if (existing) throw new ConflictError('Este lote já está cadastrado para o produto.', 'LOT_DUPLICATE');

    const lot = await tx.lot.create({ data: { productId, code: input.code, expiresAt: input.expiresAt ?? null } });
    await writeAudit(tx, context, { action: 'lots.create', result: 'SUCCESS', entityType: 'Lot', entityId: lot.id, metadata: { productId, code: lot.code } });
    return lot;
  });
}

export async function listLots(productId: string) {
  return getPrisma().lot.findMany({ where: { productId }, orderBy: { createdAt: 'desc' }, take: 200 });
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export async function listCategories(includeInactive: boolean) {
  return getPrisma().category.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  });
}

export async function createCategory(input: CategoryCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.category.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } }, select: { id: true } });
    if (duplicate) throw new ConflictError('Já existe uma categoria com este nome.', 'CATEGORY_DUPLICATE');
    const category = await tx.category.create({ data: input });
    await writeAudit(tx, context, { action: 'categories.create', result: 'SUCCESS', entityType: 'Category', entityId: category.id, metadata: { name: category.name } });
    return category;
  });
}

export async function updateCategory(categoryId: string, input: CategoryUpdateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.category.findUnique({ where: { id: categoryId } });
    if (!current) throw new NotFoundError('Categoria não encontrada.');
    if (input.name) {
      const duplicate = await tx.category.findFirst({
        where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: categoryId } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictError('Já existe uma categoria com este nome.', 'CATEGORY_DUPLICATE');
    }
    const changes = diffFields(current as unknown as Record<string, unknown>, input as Record<string, unknown>);
    const category = await tx.category.update({ where: { id: categoryId }, data: input });
    await writeAudit(tx, context, { action: 'categories.update', result: 'SUCCESS', entityType: 'Category', entityId: categoryId, metadata: { changes } });
    return category;
  });
}

/** Vínculos que tornam um cadastro parte do histórico — e por isso não excluível. */
async function productHistoryLinks(tx: DbClient, productId: string) {
  const [balances, movementItems, ledgerEntries, inventoryItems, discrepancies] = await Promise.all([
    tx.stockBalance.count({ where: { productId } }),
    tx.stockMovementItem.count({ where: { productId } }),
    tx.stockLedgerEntry.count({ where: { productId } }),
    tx.inventoryCountItem.count({ where: { productId } }),
    tx.discrepancy.count({ where: { productId } }),
  ]);
  return { balances, movementItems, ledgerEntries, inventoryItems, discrepancies };
}

async function lotHistoryLinks(tx: DbClient, lotId: string) {
  const [balances, movementItems, ledgerEntries, inventoryItems, discrepancies] = await Promise.all([
    tx.stockBalance.count({ where: { lotId } }),
    tx.stockMovementItem.count({ where: { lotId } }),
    tx.stockLedgerEntry.count({ where: { lotId } }),
    tx.inventoryCountItem.count({ where: { lotId } }),
    tx.discrepancy.count({ where: { lotId } }),
  ]);
  return { balances, movementItems, ledgerEntries, inventoryItems, discrepancies };
}

const hasHistory = (links: Record<string, number>) => Object.values(links).some((count) => count > 0);

/**
 * Exclusão definitiva do produto — só para cadastro criado por engano.
 * Com qualquer histórico (saldo, movimentação, inventário ou divergência) a exclusão
 * é recusada: apagar corromperia o histórico do estoque. Nesse caso, desative o produto.
 */
export async function deleteProduct(productId: string, context: RequestContext) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, internalCode: true, name: true } });
    if (!product) throw new NotFoundError('Produto não encontrado.');

    const links = await productHistoryLinks(tx, productId);
    if (hasHistory(links)) {
      throw new BusinessRuleError(
        'PRODUCT_HAS_HISTORY',
        'Este produto já tem histórico no estoque (movimentações, saldo, inventário ou divergências) e não pode ser excluído. Desative-o para tirá-lo de uso mantendo o histórico.',
        links,
      );
    }

    // Alertas são derivados do cadastro (ex.: estoque abaixo do mínimo) e saem junto.
    await tx.alert.deleteMany({ where: { productId } });
    await tx.lot.deleteMany({ where: { productId } });
    await tx.product.delete({ where: { id: productId } });
    await writeAudit(tx, context, {
      action: 'products.delete',
      result: 'SUCCESS',
      entityType: 'Product',
      entityId: productId,
      metadata: { before: { internalCode: product.internalCode, name: product.name } },
    });
  });
}

/** Exclusão do lote, permitida enquanto ele nunca foi usado em nenhuma operação. */
export async function deleteLot(lotId: string, context: RequestContext) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const lot = await tx.lot.findUnique({ where: { id: lotId }, select: { id: true, code: true, productId: true } });
    if (!lot) throw new NotFoundError('Lote não encontrado.');

    const links = await lotHistoryLinks(tx, lotId);
    if (hasHistory(links)) {
      throw new BusinessRuleError('LOT_HAS_HISTORY', 'Este lote já foi usado em operações de estoque e não pode ser excluído.', links);
    }

    await tx.lot.delete({ where: { id: lotId } });
    await writeAudit(tx, context, {
      action: 'lots.delete',
      result: 'SUCCESS',
      entityType: 'Lot',
      entityId: lotId,
      metadata: { productId: lot.productId, code: lot.code },
    });
  });
}
