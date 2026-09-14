import type { FastifyBaseLogger } from 'fastify';
import type { UnitOfMeasure } from '../generated/prisma/enums.js';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { getPrisma, Prisma, type DbClient } from '../lib/prisma.js';
import { runTransaction } from '../lib/transaction.js';
import { createDiscrepancyRecord } from '../repositories/discrepancy.repository.js';
import {
  checkLocationOf,
  findVisibleMovement,
  lockMovement,
  type MovementDetail,
  type MovementItemDetail,
} from '../repositories/movement.repository.js';
import { findProductByCode } from '../repositories/product.repository.js';
import type { Actor } from '../types/fastify.js';
import { decimal, isQuantityCompatibleWithUnit } from '../utils/quantity.js';
import type { RequestContext } from '../utils/request-context.js';
import type { CheckConfirmInput, CheckScanInput } from '../validators/movement.schemas.js';
import { evaluateRecurringDiscrepancy, evaluateRepeatedInvalidAttempts, raiseAlert } from './alert.service.js';
import { writeAudit } from './audit.service.js';
import { finalizeMovement, getMovement, reportStockShortage } from './movement.service.js';
import { getSetting } from './settings.service.js';

/**
 * Conferência: o operador informa o que ENCONTROU (endereço, produto, lote e
 * quantidade) e o sistema compara com o ESPERADO. Nada é confirmado automaticamente.
 */
export type CheckErrorCode =
  | 'WRONG_LOCATION'
  | 'WRONG_DESTINATION'
  | 'PRODUCT_NOT_FOUND'
  | 'WRONG_PRODUCT'
  | 'LOT_REQUIRED'
  | 'WRONG_LOT'
  | 'INVALID_QUANTITY_FOR_UNIT'
  | 'QUANTITY_MISMATCH';

export interface CheckError {
  code: CheckErrorCode;
  message: string;
  expected: string | null;
  informed: string | null;
}

export interface ExpectedItem {
  locationCode: string | null;
  destinationCode: string | null;
  productInternalCode: string;
  productBarcode: string | null;
  productName: string;
  unit: UnitOfMeasure;
  lotCode: string | null;
  tracksLot: boolean;
  quantity: string;
}

const normalize = (value: string | null | undefined) => (value ?? '').trim().toUpperCase();

/** Comparação pura (sem banco) — testada isoladamente. */
export function compareScan(expected: ExpectedItem, scan: CheckScanInput, scannedProduct: { internalCode: string; name: string } | null): CheckError[] {
  const errors: CheckError[] = [];

  if (expected.locationCode && normalize(scan.locationCode) !== normalize(expected.locationCode)) {
    errors.push({
      code: 'WRONG_LOCATION',
      message: `Endereço incorreto.\n\nEndereço esperado: ${expected.locationCode}\nEndereço informado: ${scan.locationCode}\n\nVá até o endereço correto e leia a etiqueta novamente.`,
      expected: expected.locationCode,
      informed: scan.locationCode,
    });
  }

  if (expected.destinationCode && normalize(scan.destinationCode) !== normalize(expected.destinationCode)) {
    errors.push({
      code: 'WRONG_DESTINATION',
      message: `Endereço de destino incorreto.\n\nDestino esperado: ${expected.destinationCode}\nDestino informado: ${scan.destinationCode ?? '(não informado)'}\n\nLeia a etiqueta do endereço de destino.`,
      expected: expected.destinationCode,
      informed: scan.destinationCode ?? null,
    });
  }

  const matchesProduct =
    normalize(scan.productCode) === normalize(expected.productInternalCode) ||
    (expected.productBarcode !== null && scan.productCode.trim() === expected.productBarcode);

  if (!matchesProduct) {
    if (!scannedProduct) {
      errors.push({
        code: 'PRODUCT_NOT_FOUND',
        message: `Código não cadastrado.\n\nProduto esperado: Código ${expected.productInternalCode} (${expected.productName})\nCódigo informado: ${scan.productCode}\n\nVerifique a etiqueta do produto e tente novamente.`,
        expected: expected.productInternalCode,
        informed: scan.productCode,
      });
    } else {
      errors.push({
        code: 'WRONG_PRODUCT',
        message: `Produto incorreto.\n\nProduto esperado: Código ${expected.productInternalCode}\nProduto informado: Código ${scannedProduct.internalCode}\n\nVerifique o endereço e tente novamente.`,
        expected: expected.productInternalCode,
        informed: scannedProduct.internalCode,
      });
    }
  }

  if (expected.tracksLot && expected.lotCode) {
    if (!scan.lotCode) {
      errors.push({
        code: 'LOT_REQUIRED',
        message: `Informe o lote do produto.\n\nLote esperado: ${expected.lotCode}`,
        expected: expected.lotCode,
        informed: null,
      });
    } else if (normalize(scan.lotCode) !== normalize(expected.lotCode)) {
      errors.push({
        code: 'WRONG_LOT',
        message: `Lote incorreto.\n\nLote esperado: ${expected.lotCode}\nLote informado: ${scan.lotCode}\n\nSepare o lote correto.`,
        expected: expected.lotCode,
        informed: scan.lotCode,
      });
    }
  }

  if (!isQuantityCompatibleWithUnit(scan.quantity, expected.unit)) {
    errors.push({
      code: 'INVALID_QUANTITY_FOR_UNIT',
      message: `A unidade ${expected.unit} não aceita quantidade fracionada.`,
      expected: expected.unit,
      informed: scan.quantity,
    });
  } else if (!decimal(scan.quantity).eq(expected.quantity)) {
    errors.push({
      code: 'QUANTITY_MISMATCH',
      message: `Quantidade divergente.\n\nQuantidade esperada: ${decimal(expected.quantity).toString()} ${expected.unit}\nQuantidade informada: ${decimal(scan.quantity).toString()} ${expected.unit}\n\nConte novamente antes de confirmar.`,
      expected: decimal(expected.quantity).toString(),
      informed: decimal(scan.quantity).toString(),
    });
  }

  return errors;
}

function expectedOf(movement: MovementDetail, item: MovementItemDetail): ExpectedItem {
  return {
    locationCode: checkLocationOf(movement.type, item)?.code ?? null,
    destinationCode: movement.type === 'TRANSFER' ? (item.toLocation?.code ?? null) : null,
    productInternalCode: item.product.internalCode,
    productBarcode: item.product.barcode,
    productName: item.product.name,
    unit: item.unit,
    lotCode: item.lot?.code ?? null,
    tracksLot: item.product.tracksLot,
    quantity: item.expectedQuantity.toString(),
  };
}

async function assertCheckable(db: DbClient, actor: Actor, movementId: string): Promise<MovementDetail> {
  const movement = await findVisibleMovement(db, actor, movementId);
  if (movement.status !== 'PENDING_CHECK') {
    throw new ConflictError('Esta movimentação não está aguardando conferência.', 'MOVEMENT_NOT_PENDING_CHECK');
  }
  if (movement.createdById === actor.userId && !(await getSetting('check.allowSelfCheck', db))) {
    throw new ForbiddenError('Dupla checagem ativa: a conferência deve ser feita por outra pessoa, não por quem registrou a movimentação.');
  }
  return movement;
}

interface EvaluatedScan {
  item: MovementItemDetail;
  scan: CheckScanInput;
  errors: CheckError[];
}

async function evaluateScans(db: DbClient, actor: Actor, movement: MovementDetail, scans: CheckScanInput[]): Promise<EvaluatedScan[]> {
  const results: EvaluatedScan[] = [];
  for (const scan of scans) {
    const item = movement.items.find((candidate) => candidate.id === scan.itemId);
    if (!item) throw new NotFoundError('Item não pertence a esta movimentação.');
    const scanned = await findProductByCode(db, scan.productCode);
    results.push({ item, scan, errors: compareScan(expectedOf(movement, item), scan, scanned) });
  }

  await db.checkAttempt.createMany({
    data: results.map((result) => ({
      movementId: movement.id,
      movementItemId: result.item.id,
      userId: actor.userId,
      scannedLocationCode: result.scan.locationCode.slice(0, 40),
      scannedProductCode: result.scan.productCode.slice(0, 64),
      scannedLotCode: result.scan.lotCode?.slice(0, 60) ?? null,
      informedQuantity: result.scan.quantity,
      result: result.errors.length === 0 ? 'MATCH' : 'MISMATCH',
      errorCodes: result.errors.map((error) => error.code),
    })),
  });
  // Marca o início da conferência (base do tempo médio por operação).
  await db.stockMovement.updateMany({
    where: { id: movement.id, status: 'PENDING_CHECK', checkStartedAt: null },
    data: { checkStartedAt: new Date() },
  });
  return results;
}

async function raiseCheckAlerts(actor: Actor, movement: MovementDetail, results: EvaluatedScan[], log?: FastifyBaseLogger) {
  if (!results.some((result) => result.errors.length > 0)) return;
  const prisma = getPrisma();
  try {
    await evaluateRepeatedInvalidAttempts(prisma, actor.userId);
    for (const result of results.filter((entry) => entry.errors.some((error) => error.code === 'WRONG_LOCATION' || error.code === 'WRONG_PRODUCT'))) {
      const wrongAttempts = await prisma.checkAttempt.count({ where: { movementItemId: result.item.id, result: 'MISMATCH' } });
      if (wrongAttempts < 3) continue;
      const location = checkLocationOf(movement.type, result.item);
      await raiseAlert(prisma, {
        type: 'WRONG_LOCATION',
        severity: 'WARNING',
        title: `Produto não localizado no endereço esperado: ${result.item.product.internalCode}`,
        message:
          `${wrongAttempts} leituras incorretas na operação #${movement.number} (endereço ${location?.code ?? '-'}). ` +
          'Possível produto em endereço incorreto ou etiqueta trocada — verifique fisicamente.',
        dedupeKey: `WRONG_LOCATION:${result.item.id}`,
        productId: result.item.productId,
        locationId: location?.id ?? null,
        movementId: movement.id,
      });
    }
  } catch (error) {
    log?.error({ err: error }, 'Falha ao avaliar alertas de conferência');
  }
}

function present(result: EvaluatedScan) {
  return {
    itemId: result.item.id,
    result: result.errors.length === 0 ? ('MATCH' as const) : ('MISMATCH' as const),
    product: { internalCode: result.item.product.internalCode, name: result.item.product.name },
    errors: result.errors,
  };
}

/** Valida a leitura de um item e devolve o resultado imediato para a tela. */
export async function checkItem(actor: Actor, movementId: string, scan: CheckScanInput, log?: FastifyBaseLogger) {
  const prisma = getPrisma();
  const movement = await assertCheckable(prisma, actor, movementId);
  const [result] = await evaluateScans(prisma, actor, movement, [scan]);
  await raiseCheckAlerts(actor, movement, [result!], log);
  return present(result!);
}

/**
 * Confirmação final: revalida TODOS os itens no servidor (não confia em validações
 * anteriores feitas pela tela) e só então aplica ao estoque.
 */
export async function confirmWithCheck(actor: Actor, movementId: string, input: CheckConfirmInput, context: RequestContext, log?: FastifyBaseLogger) {
  const prisma = getPrisma();
  const movement = await assertCheckable(prisma, actor, movementId);

  const informedIds = input.items.map((item) => item.itemId);
  const missing = movement.items.filter((item) => !informedIds.includes(item.id));
  if (missing.length > 0 || new Set(informedIds).size !== informedIds.length) {
    throw new ValidationError('Confira cada item exatamente uma vez antes de confirmar.', {
      missingItems: missing.map((item) => item.product.internalCode),
    });
  }

  const results = await evaluateScans(prisma, actor, movement, input.items);
  await raiseCheckAlerts(actor, movement, results, log);

  const blocking = results.filter((result) => result.errors.some((error) => error.code !== 'QUANTITY_MISMATCH'));
  if (blocking.length > 0) {
    throw new BusinessRuleError('CHECK_FAILED', 'Conferência com erros. Corrija os itens indicados antes de confirmar.', {
      items: blocking.map(present),
    });
  }

  const variances = results.filter((result) => result.errors.length > 0);
  if (variances.length > 0 && (!actor.permissions.has('movements.confirm_variance') || !input.varianceReason)) {
    throw new BusinessRuleError(
      'QUANTITY_VARIANCE',
      'Há diferença de quantidade. Conte novamente; se a diferença for real, registre a divergência e solicite a um gestor a confirmação com justificativa.',
      { items: variances.map(present) },
    );
  }

  try {
    await runTransaction(async (tx) => {
      const locked = await lockMovement(tx, movementId);
      if (locked.status !== 'PENDING_CHECK') {
        throw new ConflictError('Esta movimentação já foi processada por outra operação.', 'MOVEMENT_ALREADY_PROCESSED');
      }

      const quantities = new Map<string, Prisma.Decimal>(results.map((result) => [result.item.id, decimal(result.scan.quantity)]));
      await finalizeMovement(tx, locked, quantities, actor.userId, { checkedById: actor.userId, checkedAt: new Date() });

      for (const variance of variances) {
        const location = checkLocationOf(locked.type, variance.item);
        const discrepancy = await createDiscrepancyRecord(tx, {
          type: 'QUANTITY_MISMATCH',
          origin: 'CHECK',
          description:
            `Conferência da movimentação #${locked.number}: esperado ${variance.item.expectedQuantity.toString()} ${variance.item.unit}, ` +
            `encontrado ${decimal(variance.scan.quantity).toString()} ${variance.item.unit}. Justificativa: ${input.varianceReason}`,
          reportedById: actor.userId,
          operationUserId: locked.createdById,
          productId: variance.item.productId,
          lotId: variance.item.lotId,
          locationId: location?.id ?? null,
          movementId: locked.id,
          movementItemId: variance.item.id,
          expectedQuantity: variance.item.expectedQuantity,
          foundQuantity: variance.scan.quantity,
        });
        await evaluateRecurringDiscrepancy(tx, variance.item.productId, discrepancy.id);
      }

      await writeAudit(tx, context, {
        action: 'movements.confirm',
        result: 'SUCCESS',
        entityType: 'StockMovement',
        entityId: movementId,
        metadata: {
          number: locked.number,
          type: locked.type,
          items: locked.items.length,
          variances: variances.map((variance) => ({ itemId: variance.item.id, expected: variance.item.expectedQuantity.toString(), found: variance.scan.quantity })),
          varianceReason: input.varianceReason ?? null,
        },
      });
    });
  } catch (error) {
    await reportStockShortage(error, log);
    throw error;
  }

  return getMovement(actor, movementId);
}
