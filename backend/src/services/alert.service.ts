import type { AlertSeverity, AlertStatus, AlertType } from '../generated/prisma/enums.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma, type DbClient } from '../lib/prisma.js';
import type { RequestContext } from '../utils/request-context.js';
import { writeAudit } from './audit.service.js';
import { getSetting } from './settings.service.js';
import { getProductTotal } from './stock-engine.service.js';

/**
 * Alertas acionáveis e deduplicados: enquanto um alerta com a mesma chave está
 * aberto, novas ocorrências só incrementam o contador (sem inundar a tela).
 * A linguagem é orientada a processo — alertas sobre pessoas sugerem apoio, não punição.
 */
export interface RaiseAlertInput {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  dedupeKey: string;
  productId?: string | null;
  locationId?: string | null;
  movementId?: string | null;
  discrepancyId?: string | null;
  relatedUserId?: string | null;
}

export async function raiseAlert(db: DbClient, input: RaiseAlertInput): Promise<void> {
  const now = new Date();
  const data = {
    type: input.type,
    severity: input.severity,
    title: input.title.slice(0, 160),
    message: input.message.slice(0, 1000),
    dedupeKey: input.dedupeKey,
    productId: input.productId ?? null,
    locationId: input.locationId ?? null,
    movementId: input.movementId ?? null,
    discrepancyId: input.discrepancyId ?? null,
    relatedUserId: input.relatedUserId ?? null,
  };
  const update = () =>
    db.alert.update({
      where: { openDedupeKey: input.dedupeKey },
      data: { occurrences: { increment: 1 }, lastOccurredAt: now, message: data.message, severity: data.severity },
    });

  const existing = await db.alert.findUnique({ where: { openDedupeKey: input.dedupeKey }, select: { id: true } });
  if (existing) {
    await update();
    return;
  }
  try {
    await db.alert.create({ data: { ...data, openDedupeKey: input.dedupeKey, lastOccurredAt: now } });
  } catch (error) {
    // Criado em paralelo por outra requisição: conta como nova ocorrência.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') await update();
    else throw error;
  }
}

/** Resolve automaticamente alertas cuja condição deixou de existir. */
export async function autoResolveAlert(db: DbClient, dedupeKey: string): Promise<void> {
  await db.alert.updateMany({
    where: { openDedupeKey: dedupeKey },
    data: { status: 'RESOLVED', resolvedAt: new Date(), openDedupeKey: null },
  });
}

/** Alertas são efeito colateral: falhas nunca derrubam a operação principal. */
export async function raiseAlertSafe(input: RaiseAlertInput, log?: { error: (obj: unknown, msg: string) => void }): Promise<void> {
  try {
    await raiseAlert(getPrisma(), input);
  } catch (error) {
    log?.error({ err: error, type: input.type }, 'Falha ao registrar alerta');
  }
}

// ---------------------------------------------------------------------------
// Regras de alerta
// ---------------------------------------------------------------------------

export async function evaluateLowStock(db: DbClient, productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return;
  const products = await db.product.findMany({
    where: { id: { in: unique } },
    select: { id: true, internalCode: true, name: true, minStock: true, unit: true },
  });
  for (const product of products) {
    const key = `LOW_STOCK:${product.id}`;
    const total = await getProductTotal(db, product.id);
    if (product.minStock.gt(0) && total.lt(product.minStock)) {
      await raiseAlert(db, {
        type: 'LOW_STOCK',
        severity: total.eq(0) ? 'CRITICAL' : 'WARNING',
        title: `Estoque abaixo do mínimo: ${product.internalCode}`,
        message: `${product.name}: saldo ${total.toString()} ${product.unit}, mínimo ${product.minStock.toString()} ${product.unit}. Avalie reposição.`,
        dedupeKey: key,
        productId: product.id,
      });
    } else {
      await autoResolveAlert(db, key);
    }
  }
}

export async function evaluateRepeatedInvalidAttempts(db: DbClient, userId: string): Promise<void> {
  const rule = await getSetting('alerts.invalidAttempts', db);
  const since = new Date(Date.now() - rule.windowMinutes * 60_000);
  const count = await db.checkAttempt.count({ where: { userId, result: 'MISMATCH', createdAt: { gte: since } } });
  if (count < rule.count) return;

  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await raiseAlert(db, {
    type: 'REPEATED_INVALID_ATTEMPTS',
    severity: 'WARNING',
    title: 'Tentativas repetidas de conferência incorreta',
    message:
      `${count} leituras não conferiram em ${rule.windowMinutes} min (${user?.name ?? 'usuário'}). ` +
      'Verifique etiquetas, endereçamento, cadastro de códigos ou se o colaborador precisa de apoio.',
    dedupeKey: `REPEATED_INVALID_ATTEMPTS:${userId}`,
    relatedUserId: userId,
  });
}

export async function evaluateRecurringDiscrepancy(db: DbClient, productId: string, discrepancyId: string): Promise<void> {
  const rule = await getSetting('alerts.recurringDiscrepancy', db);
  const since = new Date(Date.now() - rule.windowDays * 86_400_000);
  const count = await db.discrepancy.count({ where: { productId, status: { not: 'DISCARDED' }, createdAt: { gte: since } } });
  if (count < rule.count) return;

  const product = await db.product.findUnique({ where: { id: productId }, select: { internalCode: true, name: true } });
  await raiseAlert(db, {
    type: 'RECURRING_DISCREPANCY',
    severity: 'WARNING',
    title: `Divergências recorrentes: ${product?.internalCode ?? 'produto'}`,
    message:
      `${count} divergências em ${rule.windowDays} dias para ${product?.name ?? 'o produto'}. ` +
      'Investigue causa comum: cadastro, embalagem, etiqueta, endereço ou fornecedor.',
    dedupeKey: `RECURRING_DISCREPANCY:${productId}`,
    productId,
    discrepancyId,
  });
}

/** Varredura periódica de operações paradas (executada pelo job de alertas). */
export async function scanPendingOperations(db: DbClient = getPrisma()): Promise<{ raised: number; resolved: number }> {
  const hours = await getSetting('alerts.pendingHours', db);
  const threshold = new Date(Date.now() - hours * 3_600_000);

  const stale = await db.stockMovement.findMany({
    where: { status: { in: ['PENDING_CHECK', 'PENDING_APPROVAL'] }, createdAt: { lt: threshold } },
    select: { id: true, number: true, type: true, status: true, createdAt: true },
    take: 500,
  });
  for (const movement of stale) {
    const waitingHours = Math.floor((Date.now() - movement.createdAt.getTime()) / 3_600_000);
    await raiseAlert(db, {
      type: 'PENDING_OPERATION',
      severity: waitingHours >= hours * 3 ? 'CRITICAL' : 'WARNING',
      title: `Operação #${movement.number} pendente há ${waitingHours}h`,
      message: `Movimentação ${movement.type} aguardando ${movement.status === 'PENDING_CHECK' ? 'conferência' : 'aprovação'}. Conclua, redistribua ou cancele com justificativa.`,
      dedupeKey: `PENDING_OPERATION:${movement.id}`,
      movementId: movement.id,
    });
  }

  // Resolve alertas de operações que já saíram do estado pendente.
  const openAlerts = await db.alert.findMany({
    where: { type: 'PENDING_OPERATION', status: { not: 'RESOLVED' } },
    select: { dedupeKey: true, movement: { select: { status: true } } },
  });
  let resolved = 0;
  for (const alert of openAlerts) {
    if (!alert.movement || !['PENDING_CHECK', 'PENDING_APPROVAL'].includes(alert.movement.status)) {
      await autoResolveAlert(db, alert.dedupeKey);
      resolved += 1;
    }
  }
  return { raised: stale.length, resolved };
}

// ---------------------------------------------------------------------------
// Consulta e tratamento
// ---------------------------------------------------------------------------

export interface AlertFilters {
  status?: AlertStatus;
  type?: AlertType;
  severity?: AlertSeverity;
  page: number;
  pageSize: number;
}

export async function listAlerts(filters: AlertFilters) {
  const where: Prisma.AlertWhereInput = {
    ...(filters.status ? { status: filters.status } : { status: { not: 'RESOLVED' } }),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
  };
  const prisma = getPrisma();
  const [total, items] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({
      where,
      orderBy: [{ severity: 'desc' }, { lastOccurredAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        product: { select: { id: true, internalCode: true, name: true } },
        location: { select: { id: true, code: true } },
        movement: { select: { id: true, number: true, type: true, status: true } },
        relatedUser: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { total, items };
}

export async function countOpenAlerts() {
  const groups = await getPrisma().alert.groupBy({ by: ['severity'], where: { status: { not: 'RESOLVED' } }, _count: { _all: true } });
  return Object.fromEntries(groups.map((group) => [group.severity, group._count._all])) as Partial<Record<AlertSeverity, number>>;
}

export async function changeAlertStatus(alertId: string, target: 'ACKNOWLEDGED' | 'RESOLVED', actorId: string, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const alert = await tx.alert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundError('Alerta não encontrado.');
    if (alert.status === 'RESOLVED') throw new ConflictError('Este alerta já foi resolvido.', 'ALERT_ALREADY_RESOLVED');
    if (alert.status === target) throw new ConflictError('O alerta já está neste status.', 'ALERT_STATUS_UNCHANGED');

    const updated = await tx.alert.update({
      where: { id: alertId },
      data:
        target === 'RESOLVED'
          ? { status: 'RESOLVED', resolvedAt: new Date(), openDedupeKey: null, acknowledgedById: alert.acknowledgedById ?? actorId, acknowledgedAt: alert.acknowledgedAt ?? new Date() }
          : { status: 'ACKNOWLEDGED', acknowledgedById: actorId, acknowledgedAt: new Date() },
    });
    await writeAudit(tx, context, { action: `alerts.${target.toLowerCase()}`, result: 'SUCCESS', entityType: 'Alert', entityId: alertId, metadata: { type: alert.type } });
    return updated;
  });
}
