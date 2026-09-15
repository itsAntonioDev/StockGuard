import type { FastifyBaseLogger } from 'fastify';
import type { DiscrepancyType, InventoryStatus } from '../generated/prisma/enums.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma, type TxClient } from '../lib/prisma.js';
import { runTransaction } from '../lib/transaction.js';
import { createDiscrepancyRecord } from '../repositories/discrepancy.repository.js';
import { findLocationByCode } from '../repositories/location.repository.js';
import { lockMovement } from '../repositories/movement.repository.js';
import { findProductByCode } from '../repositories/product.repository.js';
import type { Actor } from '../types/fastify.js';
import { decimal, isQuantityCompatibleWithUnit, toNumber } from '../utils/quantity.js';
import type { RequestContext } from '../utils/request-context.js';
import { skipTake, toPage } from '../validators/common.js';
import type {
  InventoryCountInput,
  InventoryCreateInput,
  InventoryItemsQuery,
  InventoryListQuery,
} from '../validators/inventory.schemas.js';
import { evaluateRecurringDiscrepancy } from './alert.service.js';
import { writeAudit } from './audit.service.js';
import { finalizeMovement, reportStockShortage } from './movement.service.js';

/**
 * Inventário:
 * 1. Abertura — fotografa o saldo do escopo e CONGELA os endereços (nenhuma
 *    movimentação nova ou pendente pode alterá-los durante a contagem).
 * 2. Contagem — cega por padrão; recontagens ficam registradas separadamente.
 * 3. Envio — cada diferença vira uma divergência para análise.
 * 4. Aprovação — por outra pessoa; aplica os ajustes numa movimentação INVENTORY rastreável.
 */
const IN_PROGRESS: InventoryStatus[] = ['OPEN', 'SUBMITTED'];
const userRef = { select: { id: true, name: true } } as const;

const itemSelect = {
  id: true,
  systemQuantity: true,
  countedQuantity: true,
  recountQuantity: true,
  countedAt: true,
  location: { select: { id: true, code: true } },
  product: { select: { id: true, internalCode: true, barcode: true, name: true, unit: true, tracksLot: true } },
  lot: { select: { id: true, code: true, expiresAt: true } },
  countedBy: userRef,
} satisfies Prisma.InventoryCountItemSelect;

type ItemRow = Prisma.InventoryCountItemGetPayload<{ select: typeof itemSelect }>;

const finalQuantity = (item: { countedQuantity: Prisma.Decimal | null; recountQuantity: Prisma.Decimal | null }) =>
  item.recountQuantity ?? item.countedQuantity;

/** Quantidade do sistema só aparece para quem gerencia, ou depois do fim da contagem. */
function showsSystemQuantity(actor: Actor, inventory: { blind: boolean; status: InventoryStatus }) {
  return (
    !inventory.blind ||
    inventory.status !== 'OPEN' ||
    actor.permissions.has('inventory.manage') ||
    actor.permissions.has('inventory.approve')
  );
}

function presentItem(item: ItemRow, showSystem: boolean) {
  const final = finalQuantity(item);
  return {
    id: item.id,
    location: item.location,
    product: item.product,
    lot: item.lot,
    countedBy: item.countedBy,
    countedAt: item.countedAt,
    countedQuantity: toNumber(item.countedQuantity),
    recountQuantity: toNumber(item.recountQuantity),
    systemQuantity: showSystem ? toNumber(item.systemQuantity) : null,
    difference: showSystem && final !== null ? toNumber(final.minus(item.systemQuantity)) : null,
  };
}

async function lockInventory(tx: TxClient, inventoryId: string, mode: 'UPDATE' | 'SHARE') {
  if (mode === 'UPDATE') await tx.$queryRaw`SELECT 1 FROM "inventory_counts" WHERE "id" = ${inventoryId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT 1 FROM "inventory_counts" WHERE "id" = ${inventoryId}::uuid FOR SHARE`;
  const inventory = await tx.inventoryCount.findUnique({ where: { id: inventoryId } });
  if (!inventory) throw new NotFoundError('Inventário não encontrado.');
  return inventory;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listInventories(query: InventoryListQuery) {
  const prisma = getPrisma();
  const where: Prisma.InventoryCountWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.inventoryCount.count({ where }),
    prisma.inventoryCount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        sector: { select: { id: true, code: true, name: true } },
        createdBy: userRef,
        approvedBy: userRef,
        _count: { select: { items: true } },
      },
    }),
  ]);
  const counted = await prisma.inventoryCountItem.groupBy({
    by: ['inventoryCountId'],
    where: { inventoryCountId: { in: rows.map((row) => row.id) }, countedQuantity: { not: null } },
    _count: { _all: true },
  });
  const countedBy = new Map(counted.map((group) => [group.inventoryCountId, group._count._all]));
  const items = rows.map(({ _count, ...row }) => ({ ...row, progress: { total: _count.items, counted: countedBy.get(row.id) ?? 0 } }));
  return toPage(items, total, query.page, query.pageSize);
}

export async function getInventory(actor: Actor, inventoryId: string) {
  const prisma = getPrisma();
  const inventory = await prisma.inventoryCount.findUnique({
    where: { id: inventoryId },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      sector: { select: { id: true, code: true, name: true } },
      createdBy: userRef,
      approvedBy: userRef,
      movement: { select: { id: true, number: true, status: true } },
      _count: { select: { items: true } },
    },
  });
  if (!inventory) throw new NotFoundError('Inventário não encontrado.');
  const [counted, discrepancies] = await Promise.all([
    prisma.inventoryCountItem.count({ where: { inventoryCountId: inventoryId, countedQuantity: { not: null } } }),
    prisma.discrepancy.count({ where: { inventoryCountItem: { inventoryCountId: inventoryId } } }),
  ]);
  const { _count, ...rest } = inventory;
  return {
    ...rest,
    progress: { total: _count.items, counted },
    discrepancies,
    showsSystemQuantity: showsSystemQuantity(actor, inventory),
  };
}

export async function listInventoryItems(actor: Actor, inventoryId: string, query: InventoryItemsQuery) {
  const prisma = getPrisma();
  const inventory = await prisma.inventoryCount.findUnique({ where: { id: inventoryId }, select: { blind: true, status: true } });
  if (!inventory) throw new NotFoundError('Inventário não encontrado.');

  const search = query.search?.toUpperCase();
  const where: Prisma.InventoryCountItemWhereInput = {
    inventoryCountId: inventoryId,
    ...(query.onlyPending === 'true' ? { countedQuantity: null } : {}),
    ...(search
      ? { OR: [{ location: { code: { contains: search } } }, { product: { internalCode: { contains: search } } }, { product: { name: { contains: query.search!, mode: 'insensitive' } } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.inventoryCountItem.count({ where }),
    prisma.inventoryCountItem.findMany({
      where,
      select: itemSelect,
      orderBy: [{ location: { code: 'asc' } }, { product: { internalCode: 'asc' } }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);
  const showSystem = showsSystemQuantity(actor, inventory);
  return toPage(rows.map((row) => presentItem(row, showSystem)), total, query.page, query.pageSize);
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export async function openInventory(actor: Actor, input: InventoryCreateInput, context: RequestContext) {
  const inventoryId = await runTransaction(async (tx) => {
    // Serializa aberturas no mesmo armazém (evita dois inventários sobrepostos).
    await tx.$queryRaw`SELECT 1 FROM "warehouses" WHERE "id" = ${input.warehouseId}::uuid FOR UPDATE`;
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { active: true } });
    if (!warehouse) throw new BusinessRuleError('WAREHOUSE_NOT_FOUND', 'Armazém não encontrado.');
    if (!warehouse.active) throw new BusinessRuleError('WAREHOUSE_INACTIVE', 'O armazém está inativo.');

    if (input.sectorId) {
      const sector = await tx.sector.findUnique({ where: { id: input.sectorId }, select: { warehouseId: true, active: true } });
      if (!sector || sector.warehouseId !== input.warehouseId) throw new BusinessRuleError('SECTOR_INVALID', 'O setor não pertence ao armazém.');
      if (!sector.active) throw new BusinessRuleError('SECTOR_INACTIVE', 'O setor está inativo.');
    }

    const overlapping = await tx.inventoryCount.findFirst({
      where: {
        warehouseId: input.warehouseId,
        status: { in: IN_PROGRESS },
        ...(input.sectorId ? { OR: [{ sectorId: null }, { sectorId: input.sectorId }] } : {}),
      },
      select: { number: true },
    });
    if (overlapping) {
      throw new ConflictError(`Já existe um inventário em andamento (#${overlapping.number}) para este escopo.`, 'INVENTORY_ALREADY_OPEN');
    }

    const scope: Prisma.LocationWhereInput = { warehouseId: input.warehouseId, ...(input.sectorId ? { sectorId: input.sectorId } : {}) };
    const pending = await tx.stockMovement.findMany({
      where: {
        status: { in: ['PENDING_CHECK', 'PENDING_APPROVAL'] },
        items: { some: { OR: [{ fromLocation: scope }, { toLocation: scope }] } },
      },
      select: { number: true },
      orderBy: { number: 'asc' },
      take: 20,
    });
    if (pending.length > 0) {
      throw new BusinessRuleError(
        'PENDING_MOVEMENTS_IN_SCOPE',
        `Conclua ou cancele as operações pendentes neste escopo antes de abrir o inventário: ${pending.map((movement) => `#${movement.number}`).join(', ')}.`,
        { movements: pending.map((movement) => movement.number) },
      );
    }

    const balances = await tx.stockBalance.findMany({
      where: { quantity: { gt: 0 }, location: scope },
      select: { productId: true, locationId: true, lotId: true, quantity: true },
    });

    const inventory = await tx.inventoryCount.create({
      data: {
        warehouseId: input.warehouseId,
        sectorId: input.sectorId ?? null,
        blind: input.blind,
        notes: input.notes ?? null,
        createdById: actor.userId,
        items: {
          createMany: {
            data: balances.map((balance) => ({
              locationId: balance.locationId,
              productId: balance.productId,
              lotId: balance.lotId,
              systemQuantity: balance.quantity,
            })),
          },
        },
      },
      select: { id: true, number: true },
    });

    await writeAudit(tx, context, {
      action: 'inventory.open',
      result: 'SUCCESS',
      entityType: 'InventoryCount',
      entityId: inventory.id,
      metadata: { number: inventory.number, warehouseId: input.warehouseId, sectorId: input.sectorId ?? null, blind: input.blind, items: balances.length },
    });
    return inventory.id;
  });
  return getInventory(actor, inventoryId);
}

// ---------------------------------------------------------------------------
// Contagem
// ---------------------------------------------------------------------------

export async function registerCount(actor: Actor, inventoryId: string, input: InventoryCountInput, context: RequestContext) {
  return runTransaction(async (tx) => {
    // FOR SHARE: vários contadores simultâneos; o envio (FOR UPDATE) espera todos terminarem.
    const inventory = await lockInventory(tx, inventoryId, 'SHARE');
    if (inventory.status !== 'OPEN') throw new ConflictError('Este inventário não está mais em contagem.', 'INVENTORY_NOT_OPEN');

    const location = await findLocationByCode(tx, input.locationCode, inventory.warehouseId);
    if (!location) {
      throw new BusinessRuleError('LOCATION_NOT_FOUND', `Endereço ${input.locationCode} não encontrado neste armazém. Leia a etiqueta novamente.`);
    }
    if (inventory.sectorId && location.sectorId !== inventory.sectorId) {
      throw new BusinessRuleError('LOCATION_OUT_OF_SCOPE', `O endereço ${location.code} não faz parte do setor deste inventário.`);
    }

    const product = await findProductByCode(tx, input.productCode);
    if (!product) {
      throw new BusinessRuleError(
        'PRODUCT_NOT_FOUND',
        `Código ${input.productCode} não cadastrado. Se o item está fisicamente no endereço, registre uma divergência de produto não cadastrado.`,
      );
    }
    if (!isQuantityCompatibleWithUnit(input.quantity, product.unit)) {
      throw new BusinessRuleError('INVALID_QUANTITY_FOR_UNIT', `A unidade ${product.unit} do produto ${product.internalCode} não aceita quantidade fracionada.`);
    }

    let lotId: string | null = null;
    if (product.tracksLot) {
      if (!input.lotCode) throw new BusinessRuleError('LOT_REQUIRED', `O produto ${product.internalCode} exige a leitura do lote.`);
      const code = input.lotCode.toUpperCase();
      const lot = await tx.lot.findUnique({ where: { productId_code: { productId: product.id, code } }, select: { id: true } });
      if (lot) {
        lotId = lot.id;
      } else {
        if (product.tracksExpiry && !input.lotExpiresAt) {
          throw new BusinessRuleError('LOT_EXPIRY_REQUIRED', `Lote ${code} não cadastrado: informe a validade para registrá-lo.`);
        }
        lotId = (await tx.lot.create({ data: { productId: product.id, code, expiresAt: input.lotExpiresAt ?? null }, select: { id: true } })).id;
      }
    } else if (input.lotCode) {
      throw new BusinessRuleError('LOT_NOT_CONTROLLED', `O produto ${product.internalCode} não controla lote.`);
    }

    const existing = await tx.inventoryCountItem.findFirst({
      where: { inventoryCountId: inventoryId, locationId: location.id, productId: product.id, lotId },
      select: { id: true, countedQuantity: true },
    });
    const now = new Date();
    const counting = { countedById: actor.userId, countedAt: now };
    let itemId: string;
    let kind: 'UNEXPECTED' | 'COUNT' | 'RECOUNT';

    if (!existing) {
      kind = 'UNEXPECTED';
      itemId = (
        await tx.inventoryCountItem.create({
          data: { inventoryCountId: inventoryId, locationId: location.id, productId: product.id, lotId, systemQuantity: 0, countedQuantity: input.quantity, ...counting },
          select: { id: true },
        })
      ).id;
    } else if (existing.countedQuantity === null) {
      kind = 'COUNT';
      itemId = existing.id;
      await tx.inventoryCountItem.update({ where: { id: existing.id }, data: { countedQuantity: input.quantity, ...counting } });
    } else {
      // A primeira contagem é preservada; a recontagem prevalece no fechamento.
      kind = 'RECOUNT';
      itemId = existing.id;
      await tx.inventoryCountItem.update({ where: { id: existing.id }, data: { recountQuantity: input.quantity, ...counting } });
    }

    await writeAudit(tx, context, {
      action: 'inventory.count',
      result: 'SUCCESS',
      entityType: 'InventoryCountItem',
      entityId: itemId,
      metadata: { inventoryNumber: inventory.number, location: location.code, product: product.internalCode, lot: input.lotCode ?? null, quantity: input.quantity, kind },
    });

    const item = await tx.inventoryCountItem.findUniqueOrThrow({ where: { id: itemId }, select: itemSelect });
    return { kind, item: presentItem(item, showsSystemQuantity(actor, inventory)) };
  });
}

// ---------------------------------------------------------------------------
// Envio, aprovação e cancelamento
// ---------------------------------------------------------------------------

/** Classifica a diferença encontrada (função pura, testada isoladamente). */
export function classifyInventoryDifference(system: Prisma.Decimal, counted: Prisma.Decimal): DiscrepancyType | null {
  if (counted.eq(system)) return null;
  if (system.gt(0) && counted.eq(0)) return 'PRODUCT_NOT_FOUND';
  if (system.eq(0) && counted.gt(0)) return 'WRONG_LOCATION';
  return 'QUANTITY_MISMATCH';
}

export async function submitInventory(actor: Actor, inventoryId: string, context: RequestContext) {
  await runTransaction(async (tx) => {
    const inventory = await lockInventory(tx, inventoryId, 'UPDATE');
    if (inventory.status !== 'OPEN') throw new ConflictError('Este inventário não está em contagem.', 'INVENTORY_NOT_OPEN');

    const pending = await tx.inventoryCountItem.count({ where: { inventoryCountId: inventoryId, countedQuantity: null } });
    if (pending > 0) {
      throw new BusinessRuleError(
        'INVENTORY_ITEMS_PENDING',
        `Ainda há ${pending} item(ns) sem contagem. Conte todos — informe 0 quando o produto não for encontrado — antes de enviar.`,
        { pending },
      );
    }

    const items = await tx.inventoryCountItem.findMany({ where: { inventoryCountId: inventoryId }, select: { ...itemSelect, productId: true, lotId: true, locationId: true } });
    let differences = 0;
    for (const item of items) {
      const counted = finalQuantity(item)!;
      const type = classifyInventoryDifference(item.systemQuantity, counted);
      if (!type) continue;
      differences += 1;
      const lot = item.lot ? ` (lote ${item.lot.code})` : '';
      const discrepancy = await createDiscrepancyRecord(tx, {
        type,
        origin: 'INVENTORY',
        description:
          `Inventário #${inventory.number}, endereço ${item.location.code}: ${item.product.internalCode} ${item.product.name}${lot}. ` +
          `Sistema: ${item.systemQuantity.toString()} ${item.product.unit}; contado: ${counted.toString()} ${item.product.unit}.` +
          (type === 'WRONG_LOCATION' ? ' Produto encontrado em endereço sem saldo registrado.' : ''),
        reportedById: actor.userId,
        // Inventário não é operação de uma pessoa: nenhum operador é vinculado.
        operationUserId: null,
        productId: item.productId,
        lotId: item.lotId,
        locationId: item.locationId,
        inventoryCountItemId: item.id,
        expectedQuantity: item.systemQuantity,
        foundQuantity: counted,
      });
      await evaluateRecurringDiscrepancy(tx, item.productId, discrepancy.id);
    }

    await tx.inventoryCount.update({ where: { id: inventoryId }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    await writeAudit(tx, context, {
      action: 'inventory.submit',
      result: 'SUCCESS',
      entityType: 'InventoryCount',
      entityId: inventoryId,
      metadata: { number: inventory.number, items: items.length, differences },
    });
  });
  return getInventory(actor, inventoryId);
}

export async function approveInventory(actor: Actor, inventoryId: string, context: RequestContext, log?: FastifyBaseLogger) {
  try {
    await runTransaction(async (tx) => {
      const inventory = await lockInventory(tx, inventoryId, 'UPDATE');
      if (inventory.status !== 'SUBMITTED') throw new ConflictError('O inventário precisa estar enviado para revisão.', 'INVENTORY_NOT_SUBMITTED');
      // Segregação de funções: quem abriu o inventário não aprova os ajustes.
      if (inventory.createdById === actor.userId) {
        throw new BusinessRuleError('SELF_APPROVAL_FORBIDDEN', 'O inventário deve ser aprovado por outra pessoa, não por quem o abriu.');
      }

      const items = await tx.inventoryCountItem.findMany({
        where: { inventoryCountId: inventoryId },
        select: { productId: true, lotId: true, locationId: true, systemQuantity: true, countedQuantity: true, recountQuantity: true, product: { select: { unit: true } } },
      });
      const adjustments = items
        .map((item) => ({ item, difference: finalQuantity(item)!.minus(item.systemQuantity) }))
        .filter((entry) => !entry.difference.eq(0));

      let movementId: string | null = null;
      if (adjustments.length > 0) {
        const movement = await tx.stockMovement.create({
          data: {
            type: 'INVENTORY',
            status: 'PENDING_APPROVAL',
            warehouseId: inventory.warehouseId,
            reason: `Ajuste do inventário #${inventory.number}`,
            idempotencyKey: `inventory-${inventory.id}`,
            createdById: actor.userId,
            items: {
              create: adjustments.map(({ item, difference }) => ({
                productId: item.productId,
                lotId: item.lotId,
                fromLocationId: difference.lt(0) ? item.locationId : null,
                toLocationId: difference.gt(0) ? item.locationId : null,
                expectedQuantity: difference.abs(),
                unit: item.product.unit,
                direction: difference.gt(0) ? 1 : -1,
              })),
            },
          },
          select: { id: true },
        });
        const locked = await lockMovement(tx, movement.id);
        await finalizeMovement(tx, locked, new Map(), actor.userId, { approvedById: actor.userId, approvedAt: new Date() });
        movementId = movement.id;
      }

      await tx.inventoryCount.update({
        where: { id: inventoryId },
        data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date(), movementId },
      });
      await writeAudit(tx, context, {
        action: 'inventory.approve',
        result: 'SUCCESS',
        entityType: 'InventoryCount',
        entityId: inventoryId,
        metadata: {
          number: inventory.number,
          adjustments: adjustments.length,
          netDifference: adjustments.reduce((sum, entry) => sum.plus(entry.difference), decimal(0)).toString(),
          movementId,
        },
      });
    });
  } catch (error) {
    await reportStockShortage(error, log);
    throw error;
  }
  return getInventory(actor, inventoryId);
}

export async function cancelInventory(actor: Actor, inventoryId: string, reason: string, context: RequestContext) {
  await runTransaction(async (tx) => {
    const inventory = await lockInventory(tx, inventoryId, 'UPDATE');
    if (!IN_PROGRESS.includes(inventory.status)) throw new ConflictError('Este inventário já foi finalizado.', 'INVENTORY_FINALIZED');
    await tx.inventoryCount.update({ where: { id: inventoryId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await writeAudit(tx, context, {
      action: 'inventory.cancel',
      result: 'SUCCESS',
      entityType: 'InventoryCount',
      entityId: inventoryId,
      metadata: { number: inventory.number, previousStatus: inventory.status, reason },
    });
  });
  return getInventory(actor, inventoryId);
}
