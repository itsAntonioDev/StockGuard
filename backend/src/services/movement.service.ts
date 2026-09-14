import type { FastifyBaseLogger } from 'fastify';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../lib/errors.js';
import { getPrisma, Prisma, type DbClient, type TxClient } from '../lib/prisma.js';
import { runTransaction } from '../lib/transaction.js';
import { assertLocationsNotUnderInventory } from '../repositories/location.repository.js';
import {
  findVisibleMovement,
  lockMovement,
  movementDetailInclude,
  movementListSelect,
  movementScopeWhere,
  presentMovement,
  type MovementDetail,
} from '../repositories/movement.repository.js';
import type { Actor } from '../types/fastify.js';
import { decimal, isQuantityCompatibleWithUnit } from '../utils/quantity.js';
import type { RequestContext } from '../utils/request-context.js';
import { skipTake, toPage } from '../validators/common.js';
import type { MovementCreateInput, MovementListQuery } from '../validators/movement.schemas.js';
import { autoResolveAlert, evaluateLowStock, raiseAlertSafe } from './alert.service.js';
import { writeAudit } from './audit.service.js';
import { getSetting } from './settings.service.js';
import { applyStockDeltas, getAvailableQuantity, StockEngineError, type StockDelta } from './stock-engine.service.js';

const TYPE_LABEL: Record<string, string> = {
  ENTRY: 'entrada',
  EXIT: 'saída',
  PICKING: 'separação',
  TRANSFER: 'transferência',
  ADJUSTMENT: 'ajuste',
  INVENTORY: 'inventário',
};

export interface ItemProblem {
  item: number | null;
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listMovements(actor: Actor, query: MovementListQuery) {
  const prisma = getPrisma();
  const filters: Prisma.StockMovementWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.number ? { number: query.number } : {}),
    ...(query.productId ? { items: { some: { productId: query.productId } } } : {}),
    // Filtrar por outro usuário só faz sentido (e só é permitido) com visão total.
    ...(query.createdById && actor.permissions.has('movements.read.all') ? { createdById: query.createdById } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const where: Prisma.StockMovementWhereInput = { AND: [filters, movementScopeWhere(actor)] };
  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({ where, select: movementListSelect, orderBy: { createdAt: 'desc' }, ...skipTake(query.page, query.pageSize) }),
  ]);
  return toPage(items, total, query.page, query.pageSize);
}

export async function getMovement(actor: Actor, movementId: string) {
  return presentMovement(await findVisibleMovement(getPrisma(), actor, movementId));
}

// ---------------------------------------------------------------------------
// Aplicação no estoque (compartilhada por criação direta, conferência, aprovação e inventário)
// ---------------------------------------------------------------------------

export function buildDeltas(
  movement: Pick<MovementDetail, 'type'> & { items: Array<Pick<MovementDetail['items'][number], 'id' | 'productId' | 'lotId' | 'fromLocationId' | 'toLocationId' | 'direction'>> },
  quantities: Map<string, Prisma.Decimal>,
): StockDelta[] {
  const deltas: StockDelta[] = [];
  for (const item of movement.items) {
    const quantity = quantities.get(item.id);
    if (!quantity || quantity.lte(0)) continue;
    const base = { movementItemId: item.id, productId: item.productId, lotId: item.lotId };
    const outgoing = () => deltas.push({ ...base, locationId: item.fromLocationId!, delta: quantity.negated() });
    const incoming = () => deltas.push({ ...base, locationId: item.toLocationId!, delta: quantity });

    switch (movement.type) {
      case 'ENTRY':
        incoming();
        break;
      case 'EXIT':
      case 'PICKING':
        outgoing();
        break;
      case 'TRANSFER':
        outgoing();
        incoming();
        break;
      case 'ADJUSTMENT':
      case 'INVENTORY':
        if (item.direction > 0) incoming();
        else outgoing();
        break;
    }
  }
  return deltas;
}

/**
 * Registra as quantidades confirmadas, aplica os lançamentos e finaliza a movimentação.
 * Deve rodar dentro de transação com a movimentação travada (lockMovement).
 */
export async function finalizeMovement(
  tx: TxClient,
  movement: MovementDetail,
  quantities: Map<string, Prisma.Decimal>,
  actorId: string,
  fields: Prisma.StockMovementUncheckedUpdateInput = {},
): Promise<void> {
  for (const item of movement.items) {
    const quantity = quantities.get(item.id) ?? item.expectedQuantity;
    quantities.set(item.id, quantity);
    await tx.stockMovementItem.update({ where: { id: item.id }, data: { quantity } });
  }
  await applyStockDeltas(tx, buildDeltas(movement, quantities), actorId);
  await tx.stockMovement.update({
    where: { id: movement.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), ...fields },
  });
  await evaluateLowStock(tx, movement.items.map((item) => item.productId));
  await autoResolveAlert(tx, `PENDING_OPERATION:${movement.id}`);
}

/** Registra alerta quando uma operação tenta retirar mais do que existe. */
export async function reportStockShortage(error: unknown, log?: FastifyBaseLogger): Promise<void> {
  if (!(error instanceof StockEngineError) || error.code !== 'INSUFFICIENT_STOCK') return;
  await raiseAlertSafe(
    {
      type: 'NEGATIVE_STOCK_ATTEMPT',
      severity: 'CRITICAL',
      title: 'Tentativa de retirada acima do saldo',
      message: 'Uma confirmação foi bloqueada por falta de saldo no endereço. Verifique se há divergência física ou operação simultânea.',
      dedupeKey: `NEGATIVE_STOCK_ATTEMPT:${error.delta.productId}:${error.delta.locationId}`,
      productId: error.delta.productId,
      locationId: error.delta.locationId,
    },
    log,
  );
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

interface PreparedMovement {
  problems: ItemProblem[];
  warnings: string[];
  shortages: Array<{ productId: string; locationId: string }>;
}

async function prepareMovement(db: DbClient, input: MovementCreateInput): Promise<PreparedMovement> {
  const problems: ItemProblem[] = [];
  const warnings: string[] = [];
  const shortages: PreparedMovement['shortages'] = [];

  const warehouse = await db.warehouse.findUnique({ where: { id: input.warehouseId }, select: { active: true } });
  if (!warehouse) problems.push({ item: null, code: 'WAREHOUSE_NOT_FOUND', message: 'Armazém não encontrado.' });
  else if (!warehouse.active) problems.push({ item: null, code: 'WAREHOUSE_INACTIVE', message: 'O armazém está inativo.' });

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const locationIds = [...new Set(input.items.flatMap((item) => [item.fromLocationId, item.toLocationId]).filter((id): id is string => !!id))];
  const lotIds = [...new Set(input.items.map((item) => item.lotId).filter((id): id is string => !!id))];

  const [products, locations, lots] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, internalCode: true, active: true, unit: true, tracksLot: true, tracksExpiry: true } }),
    db.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, code: true, status: true, warehouseId: true, sectorId: true, capacity: true } }),
    db.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, productId: true, code: true, expiresAt: true } }),
  ]);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
  const today = new Date(new Date().toISOString().slice(0, 10));

  const seen = new Set<string>();
  const outgoing = new Map<string, { productId: string; locationId: string; lotId: string | null; quantity: Prisma.Decimal; item: number }>();
  const incomingByLocation = new Map<string, Prisma.Decimal>();

  input.items.forEach((item, index) => {
    const n = index + 1;
    const problem = (code: string, message: string) => problems.push({ item: n, code, message: `Item ${n}: ${message}` });

    const product = productMap.get(item.productId);
    if (!product) return problem('PRODUCT_NOT_FOUND', 'produto não encontrado.');
    if (!product.active) problem('PRODUCT_INACTIVE', `o produto ${product.internalCode} está inativo.`);
    if (!isQuantityCompatibleWithUnit(item.quantity, product.unit)) {
      problem('INVALID_QUANTITY_FOR_UNIT', `a unidade ${product.unit} do produto ${product.internalCode} não aceita quantidade fracionada.`);
    }

    if (product.tracksLot) {
      if (!item.lotId && !item.lotCode) problem('LOT_REQUIRED', `o produto ${product.internalCode} exige lote.`);
      if (item.lotId) {
        const lot = lotMap.get(item.lotId);
        if (!lot || lot.productId !== product.id) problem('LOT_INVALID', `o lote informado não pertence ao produto ${product.internalCode}.`);
        else if (lot.expiresAt && lot.expiresAt < today && input.type !== 'TRANSFER') {
          problem('LOT_EXPIRED', `o lote ${lot.code} está vencido desde ${lot.expiresAt.toISOString().slice(0, 10)}.`);
        }
      }
      if (item.lotCode && item.lotExpiresAt && item.lotExpiresAt < today) problem('LOT_EXPIRED', `o lote ${item.lotCode} já está vencido.`);
    } else if (item.lotId || item.lotCode) {
      problem('LOT_NOT_CONTROLLED', `o produto ${product.internalCode} não controla lote.`);
    }

    for (const [field, locationId] of [['origem', item.fromLocationId], ['destino', item.toLocationId]] as const) {
      if (!locationId) continue;
      const location = locationMap.get(locationId);
      if (!location) {
        problem('LOCATION_NOT_FOUND', `endereço de ${field} não encontrado.`);
      } else if (location.warehouseId !== input.warehouseId) {
        problem('LOCATION_OTHER_WAREHOUSE', `o endereço ${location.code} pertence a outro armazém.`);
      } else if (location.status !== 'ACTIVE') {
        problem('LOCATION_NOT_ACTIVE', `o endereço ${location.code} está ${location.status === 'BLOCKED' ? 'bloqueado' : 'inativo'}.`);
      }
    }

    const key = [item.productId, item.lotId ?? item.lotCode ?? '', item.fromLocationId ?? '', item.toLocationId ?? '', item.direction ?? ''].join('|');
    if (seen.has(key)) problem('DUPLICATE_ITEM', `produto ${product.internalCode} repetido com o mesmo lote e endereços — some as quantidades em uma única linha.`);
    seen.add(key);

    const quantity = decimal(item.quantity);
    const isOutgoing = input.type === 'EXIT' || input.type === 'PICKING' || input.type === 'TRANSFER' || (input.type === 'ADJUSTMENT' && item.direction === 'OUT');
    if (isOutgoing && item.fromLocationId) {
      const outKey = `${item.productId}|${item.fromLocationId}|${item.lotId ?? ''}`;
      const current = outgoing.get(outKey);
      outgoing.set(outKey, {
        productId: item.productId,
        locationId: item.fromLocationId,
        lotId: item.lotId ?? null,
        quantity: (current?.quantity ?? decimal(0)).plus(quantity),
        item: n,
      });
    }
    if (item.toLocationId) incomingByLocation.set(item.toLocationId, (incomingByLocation.get(item.toLocationId) ?? decimal(0)).plus(quantity));
  });

  try {
    await assertLocationsNotUnderInventory(db, locations);
  } catch (error) {
    if (error instanceof BusinessRuleError) problems.push({ item: null, code: error.code, message: error.message });
    else throw error;
  }

  for (const request of outgoing.values()) {
    const available = await getAvailableQuantity(db, request.productId, request.locationId, request.lotId);
    if (request.quantity.gt(available)) {
      const product = productMap.get(request.productId);
      const location = locationMap.get(request.locationId);
      shortages.push({ productId: request.productId, locationId: request.locationId });
      problems.push({
        item: request.item,
        code: 'INSUFFICIENT_STOCK',
        message:
          `Item ${request.item}: estoque insuficiente do produto ${product?.internalCode ?? ''} no endereço ${location?.code ?? ''}. ` +
          `Disponível: ${available.toString()} ${product?.unit ?? ''}; solicitado: ${request.quantity.toString()} ${product?.unit ?? ''}.`,
      });
    }
  }

  for (const [locationId, incoming] of incomingByLocation) {
    const location = locationMap.get(locationId);
    if (!location?.capacity) continue;
    const occupied = await db.stockBalance.aggregate({ where: { locationId }, _sum: { quantity: true } });
    const total = (occupied._sum.quantity ?? decimal(0)).plus(incoming);
    if (total.gt(location.capacity)) {
      warnings.push(`O endereço ${location.code} ficará acima da capacidade de referência (${total.toString()} de ${location.capacity.toString()}).`);
    }
  }

  return { problems, warnings, shortages };
}

/** Mesma chave + mesma operação = repetição segura; mesma chave + outra operação = erro. */
async function findIdempotentReplay(db: DbClient, actorId: string, idempotencyKey: string, input: MovementCreateInput) {
  const existing = await db.stockMovement.findUnique({
    where: { createdById_idempotencyKey: { createdById: actorId, idempotencyKey } },
    include: movementDetailInclude,
  });
  if (!existing) return null;

  const fingerprint = (rows: Array<{ productId: string; from: string | null | undefined; to: string | null | undefined; quantity: Prisma.Decimal | string | number }>) =>
    rows
      .map((row) => `${row.productId}|${row.from ?? ''}|${row.to ?? ''}|${decimal(row.quantity).toString()}`)
      .sort()
      .join(';');

  const same =
    existing.type === input.type &&
    existing.warehouseId === input.warehouseId &&
    fingerprint(existing.items.map((item) => ({ productId: item.productId, from: item.fromLocationId, to: item.toLocationId, quantity: item.expectedQuantity }))) ===
      fingerprint(input.items.map((item) => ({ productId: item.productId, from: item.fromLocationId, to: item.toLocationId, quantity: item.quantity })));

  if (!same) throw new ConflictError('Esta chave de idempotência já foi usada em outra operação.', 'IDEMPOTENCY_KEY_REUSED');
  return existing;
}

async function resolveLotId(tx: TxClient, productId: string, item: MovementCreateInput['items'][number]): Promise<string | null> {
  if (item.lotId) return item.lotId;
  if (!item.lotCode) return null;
  const existing = await tx.lot.findUnique({ where: { productId_code: { productId, code: item.lotCode } } });
  if (existing) {
    if (item.lotExpiresAt && existing.expiresAt && existing.expiresAt.toISOString().slice(0, 10) !== item.lotExpiresAt.toISOString().slice(0, 10)) {
      throw new BusinessRuleError('LOT_EXPIRY_CONFLICT', `O lote ${item.lotCode} já existe com outra data de validade.`);
    }
    return existing.id;
  }
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { tracksExpiry: true } });
  if (product.tracksExpiry && !item.lotExpiresAt) {
    throw new BusinessRuleError('LOT_EXPIRY_REQUIRED', `Informe a validade do novo lote ${item.lotCode}.`);
  }
  const lot = await tx.lot.create({ data: { productId, code: item.lotCode, expiresAt: item.lotExpiresAt ?? null } });
  return lot.id;
}

export async function createMovement(actor: Actor, input: MovementCreateInput, idempotencyKey: string, context: RequestContext, log?: FastifyBaseLogger) {
  const requiredPermission = input.type === 'ADJUSTMENT' ? 'movements.adjust.request' : 'movements.create';
  if (!actor.permissions.has(requiredPermission)) {
    throw new ForbiddenError(`Você não tem permissão para registrar ${TYPE_LABEL[input.type]}.`);
  }

  const prisma = getPrisma();
  const replay = await findIdempotentReplay(prisma, actor.userId, idempotencyKey, input);
  if (replay) return { movement: presentMovement(replay), replayed: true, warnings: [] as string[] };

  const prepared = await prepareMovement(prisma, input);
  if (prepared.problems.length > 0) {
    for (const shortage of prepared.shortages) {
      await raiseAlertSafe(
        {
          type: 'NEGATIVE_STOCK_ATTEMPT',
          severity: 'WARNING',
          title: 'Solicitação acima do saldo disponível',
          message: 'Uma movimentação foi recusada por pedir mais do que o saldo do endereço. Verifique se há divergência física.',
          dedupeKey: `NEGATIVE_STOCK_ATTEMPT:${shortage.productId}:${shortage.locationId}`,
          productId: shortage.productId,
          locationId: shortage.locationId,
        },
        log,
      );
    }
    throw new BusinessRuleError('MOVEMENT_INVALID', 'A movimentação não pode ser registrada. Corrija os itens indicados.', { problems: prepared.problems });
  }

  const requiresCheck = (await getSetting('check.requiredTypes')) as string[];
  const status = input.type === 'ADJUSTMENT' ? 'PENDING_APPROVAL' : 'PENDING_CHECK';
  const confirmNow = input.type !== 'ADJUSTMENT' && !requiresCheck.includes(input.type);

  let movementId: string;
  try {
    movementId = await runTransaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) } }, select: { id: true, unit: true } });
      const unitOf = new Map(products.map((product) => [product.id, product.unit]));

      const items: Prisma.StockMovementItemUncheckedCreateWithoutMovementInput[] = [];
      for (const item of input.items) {
        items.push({
          productId: item.productId,
          lotId: await resolveLotId(tx, item.productId, item),
          fromLocationId: item.fromLocationId ?? null,
          toLocationId: item.toLocationId ?? null,
          expectedQuantity: item.quantity,
          unit: unitOf.get(item.productId)!,
          direction: item.direction === 'OUT' ? -1 : 1,
        });
      }

      const created = await tx.stockMovement.create({
        data: {
          type: input.type,
          status,
          warehouseId: input.warehouseId,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          referenceDoc: input.referenceDoc ?? null,
          idempotencyKey,
          createdById: actor.userId,
          items: { create: items },
        },
        select: { id: true, number: true },
      });

      if (confirmNow) {
        const locked = await lockMovement(tx, created.id);
        await finalizeMovement(tx, locked, new Map(), actor.userId);
      }

      await writeAudit(tx, context, {
        action: 'movements.create',
        result: 'SUCCESS',
        entityType: 'StockMovement',
        entityId: created.id,
        metadata: { number: created.number, type: input.type, status: confirmNow ? 'CONFIRMED' : status, items: input.items.length, referenceDoc: input.referenceDoc ?? null },
      });
      return created.id;
    });
  } catch (error) {
    // Duas requisições simultâneas com a mesma chave: a segunda devolve a primeira.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await findIdempotentReplay(prisma, actor.userId, idempotencyKey, input);
      if (concurrent) return { movement: presentMovement(concurrent), replayed: true, warnings: [] as string[] };
    }
    await reportStockShortage(error, log);
    throw error;
  }

  const movement = await prisma.stockMovement.findUniqueOrThrow({ where: { id: movementId }, include: movementDetailInclude });
  return { movement: presentMovement(movement), replayed: false, warnings: prepared.warnings };
}

// ---------------------------------------------------------------------------
// Cancelamento, aprovação e rejeição
// ---------------------------------------------------------------------------

function assertPending(movement: MovementDetail) {
  if (movement.status !== 'PENDING_CHECK' && movement.status !== 'PENDING_APPROVAL') {
    throw new ConflictError('Esta movimentação já foi finalizada.', 'MOVEMENT_NOT_PENDING');
  }
}

export async function cancelMovement(actor: Actor, movementId: string, reason: string, context: RequestContext) {
  await findVisibleMovement(getPrisma(), actor, movementId);
  await runTransaction(async (tx) => {
    const movement = await lockMovement(tx, movementId);
    assertPending(movement);
    if (movement.createdById !== actor.userId && !actor.permissions.has('movements.cancel')) {
      throw new ForbiddenError('Somente quem registrou ou um gestor pode cancelar esta movimentação.');
    }
    await tx.stockMovement.update({
      where: { id: movementId },
      data: { status: 'CANCELLED', cancelledById: actor.userId, cancelledAt: new Date(), cancelReason: reason },
    });
    await autoResolveAlert(tx, `PENDING_OPERATION:${movementId}`);
    await writeAudit(tx, context, {
      action: 'movements.cancel',
      result: 'SUCCESS',
      entityType: 'StockMovement',
      entityId: movementId,
      metadata: { number: movement.number, type: movement.type, previousStatus: movement.status, reason },
    });
  });
  return getMovement(actor, movementId);
}

async function loadPendingAdjustment(tx: TxClient, actor: Actor, movementId: string) {
  const movement = await lockMovement(tx, movementId);
  if (movement.type !== 'ADJUSTMENT') throw new BusinessRuleError('NOT_AN_ADJUSTMENT', 'Somente ajustes passam por aprovação.');
  if (movement.status !== 'PENDING_APPROVAL') throw new ConflictError('Este ajuste já foi analisado.', 'MOVEMENT_NOT_PENDING');
  // Segregação de funções: quem solicita não aprova.
  if (movement.createdById === actor.userId) {
    throw new BusinessRuleError('SELF_APPROVAL_FORBIDDEN', 'O ajuste deve ser aprovado por outra pessoa, não por quem o solicitou.');
  }
  return movement;
}

export async function approveAdjustment(actor: Actor, movementId: string, context: RequestContext, log?: FastifyBaseLogger) {
  try {
    await runTransaction(async (tx) => {
      const movement = await loadPendingAdjustment(tx, actor, movementId);
      const locations = movement.items.flatMap((item) => [item.fromLocation, item.toLocation]).filter((location) => location !== null);
      const inactive = locations.find((location) => location.status !== 'ACTIVE');
      if (inactive) throw new BusinessRuleError('LOCATION_NOT_ACTIVE', `O endereço ${inactive.code} não está ativo.`);
      await assertLocationsNotUnderInventory(tx, locations);

      await finalizeMovement(tx, movement, new Map(), actor.userId, { approvedById: actor.userId, approvedAt: new Date() });
      await writeAudit(tx, context, {
        action: 'movements.adjustment_approve',
        result: 'SUCCESS',
        entityType: 'StockMovement',
        entityId: movementId,
        metadata: { number: movement.number, requestedBy: movement.createdById, reason: movement.reason },
      });
    });
  } catch (error) {
    await reportStockShortage(error, log);
    throw error;
  }
  return getMovement(actor, movementId);
}

export async function rejectAdjustment(actor: Actor, movementId: string, reason: string, context: RequestContext) {
  await runTransaction(async (tx) => {
    const movement = await loadPendingAdjustment(tx, actor, movementId);
    await tx.stockMovement.update({
      where: { id: movementId },
      data: { status: 'REJECTED', cancelledById: actor.userId, cancelledAt: new Date(), cancelReason: reason },
    });
    await autoResolveAlert(tx, `PENDING_OPERATION:${movementId}`);
    await writeAudit(tx, context, {
      action: 'movements.adjustment_reject',
      result: 'SUCCESS',
      entityType: 'StockMovement',
      entityId: movementId,
      metadata: { number: movement.number, requestedBy: movement.createdById, reason },
    });
  });
  return getMovement(actor, movementId);
}
