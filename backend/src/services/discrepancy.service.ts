import type { DiscrepancyStatus, ProbableCause } from '../generated/prisma/enums.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma, type DbClient } from '../lib/prisma.js';
import { createDiscrepancyRecord } from '../repositories/discrepancy.repository.js';
import { movementScopeWhere } from '../repositories/movement.repository.js';
import type { Actor } from '../types/fastify.js';
import { PROBABLE_CAUSE_LABEL } from '../utils/labels.js';
import { toNumber } from '../utils/quantity.js';
import type { RequestContext } from '../utils/request-context.js';
import { skipTake, toPage } from '../validators/common.js';
import type {
  DiscrepancyCreateInput,
  DiscrepancyListQuery,
  DiscrepancyStatusChangeInput,
} from '../validators/discrepancy.schemas.js';
import { evaluateRecurringDiscrepancy } from './alert.service.js';
import { writeAudit } from './audit.service.js';
import { readEvidenceFile, storeEvidenceFile, sanitizeFileName } from './evidence-storage.js';

/**
 * Divergências servem para entender e corrigir o processo. O sistema registra o
 * contexto (quem executou a operação), mas a causa provável é sempre definida
 * por quem analisa — nunca atribuída automaticamente.
 */
export const FINAL_DISCREPANCY_STATUSES: readonly DiscrepancyStatus[] = ['CORRECTED', 'CONFIRMED', 'DISCARDED'];

const TRANSITIONS: Record<DiscrepancyStatus, readonly DiscrepancyStatus[]> = {
  OPEN: ['IN_ANALYSIS', 'DISCARDED'],
  IN_ANALYSIS: ['CORRECTED', 'CONFIRMED', 'DISCARDED'],
  CORRECTED: [],
  CONFIRMED: [],
  DISCARDED: [],
};

const MAX_EVIDENCES = 10;

/** Regras de transição (função pura, testada isoladamente). Retorna os problemas encontrados. */
export function validateStatusTransition(
  current: { status: DiscrepancyStatus; correctiveAction: string | null; probableCause: ProbableCause },
  input: DiscrepancyStatusChangeInput,
): string[] {
  if (FINAL_DISCREPANCY_STATUSES.includes(current.status)) return ['Divergência finalizada não pode mudar de status.'];
  if (!TRANSITIONS[current.status].includes(input.status)) return [`Transição não permitida: ${current.status} → ${input.status}.`];

  const problems: string[] = [];
  if (input.status === 'CORRECTED' || input.status === 'CONFIRMED') {
    if (!(input.correctiveAction ?? current.correctiveAction)) problems.push('Informe a ação corretiva adotada.');
    if ((input.probableCause ?? current.probableCause) === 'NOT_DETERMINED') {
      problems.push('Informe a causa provável identificada na análise.');
    }
  }
  if (input.status === 'DISCARDED' && !input.note) problems.push('Informe o motivo do descarte.');
  return problems;
}

const userRef = { select: { id: true, name: true } } as const;

const listSelect = {
  id: true,
  number: true,
  type: true,
  status: true,
  origin: true,
  probableCause: true,
  expectedQuantity: true,
  foundQuantity: true,
  estimatedValue: true,
  createdAt: true,
  resolvedAt: true,
  product: { select: { id: true, internalCode: true, name: true, unit: true } },
  location: { select: { id: true, code: true, sector: { select: { id: true, code: true, name: true } } } },
  movement: { select: { id: true, number: true, type: true } },
  reportedBy: userRef,
  operationUser: userRef,
  assignedTo: userRef,
} satisfies Prisma.DiscrepancySelect;

const detailInclude = {
  product: { select: { id: true, internalCode: true, name: true, unit: true } },
  lot: { select: { id: true, code: true, expiresAt: true } },
  location: { select: { id: true, code: true, sector: { select: { id: true, code: true, name: true } } } },
  movement: { select: { id: true, number: true, type: true, status: true } },
  reportedBy: userRef,
  operationUser: userRef,
  assignedTo: userRef,
  actions: { orderBy: { createdAt: 'asc' }, include: { user: userRef } },
  evidences: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedBy: userRef },
  },
} satisfies Prisma.DiscrepancyInclude;

function scopeWhere(actor: Actor): Prisma.DiscrepancyWhereInput {
  if (actor.permissions.has('discrepancies.read.all')) return {};
  return { OR: [{ reportedById: actor.userId }, { operationUserId: actor.userId }] };
}

function presentQuantities<T extends { expectedQuantity: Prisma.Decimal | null; foundQuantity: Prisma.Decimal | null; estimatedValue: Prisma.Decimal | null }>(row: T) {
  return {
    ...row,
    expectedQuantity: toNumber(row.expectedQuantity),
    foundQuantity: toNumber(row.foundQuantity),
    estimatedValue: toNumber(row.estimatedValue),
  };
}

async function findVisible(db: DbClient, actor: Actor, discrepancyId: string) {
  const discrepancy = await db.discrepancy.findFirst({
    where: { AND: [{ id: discrepancyId }, scopeWhere(actor)] },
    select: { id: true, number: true, status: true, _count: { select: { evidences: true } } },
  });
  if (!discrepancy) throw new NotFoundError('Divergência não encontrada.');
  return discrepancy;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listDiscrepancies(actor: Actor, query: DiscrepancyListQuery) {
  const prisma = getPrisma();
  const filters: Prisma.DiscrepancyWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.sectorId ? { location: { sectorId: query.sectorId } } : {}),
    ...(query.operationUserId && actor.permissions.has('discrepancies.read.all') ? { operationUserId: query.operationUserId } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const where: Prisma.DiscrepancyWhereInput = { AND: [filters, scopeWhere(actor)] };
  const [total, rows] = await Promise.all([
    prisma.discrepancy.count({ where }),
    prisma.discrepancy.findMany({ where, select: listSelect, orderBy: { createdAt: 'desc' }, ...skipTake(query.page, query.pageSize) }),
  ]);
  return toPage(rows.map(presentQuantities), total, query.page, query.pageSize);
}

export async function getDiscrepancy(actor: Actor, discrepancyId: string) {
  const discrepancy = await getPrisma().discrepancy.findFirst({
    where: { AND: [{ id: discrepancyId }, scopeWhere(actor)] },
    include: detailInclude,
  });
  if (!discrepancy) throw new NotFoundError('Divergência não encontrada.');
  return { ...presentQuantities(discrepancy), unitCostSnapshot: toNumber(discrepancy.unitCostSnapshot) };
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export async function createDiscrepancy(actor: Actor, input: DiscrepancyCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  let productId = input.productId ?? null;
  let lotId = input.lotId ?? null;
  let locationId = input.locationId ?? null;
  let movementId: string | null = null;
  let operationUserId: string | null = null;

  if (input.movementItemId) {
    // Só pode vincular a operações que o usuário consegue ver.
    const item = await prisma.stockMovementItem.findFirst({
      where: { id: input.movementItemId, movement: movementScopeWhere(actor) },
      include: { movement: { select: { id: true, type: true, createdById: true } } },
    });
    if (!item) throw new NotFoundError('Item de movimentação não encontrado.');
    movementId = item.movementId;
    operationUserId = item.movement.createdById;
    productId ??= item.productId;
    lotId ??= item.lotId;
    locationId ??= item.movement.type === 'ENTRY' ? item.toLocationId : (item.fromLocationId ?? item.toLocationId);
  }

  if (productId && !(await prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
    throw new BusinessRuleError('PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  }
  if (locationId && !(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) {
    throw new BusinessRuleError('LOCATION_NOT_FOUND', 'Endereço não encontrado.');
  }
  if (lotId) {
    const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { productId: true } });
    if (!lot || lot.productId !== productId) throw new BusinessRuleError('LOT_INVALID', 'O lote não pertence ao produto informado.');
  }

  const discrepancyId = await prisma.$transaction(async (tx) => {
    const discrepancy = await createDiscrepancyRecord(tx, {
      type: input.type,
      origin: input.movementItemId ? 'CHECK' : 'MANUAL',
      description: input.description,
      reportedById: actor.userId,
      operationUserId,
      productId,
      lotId,
      locationId,
      movementId,
      movementItemId: input.movementItemId ?? null,
      expectedQuantity: input.expectedQuantity ?? null,
      foundQuantity: input.foundQuantity ?? null,
      expectedCode: input.expectedCode ?? null,
      foundCode: input.foundCode ?? null,
    });
    if (productId) await evaluateRecurringDiscrepancy(tx, productId, discrepancy.id);
    await writeAudit(tx, context, {
      action: 'discrepancies.create',
      result: 'SUCCESS',
      entityType: 'Discrepancy',
      entityId: discrepancy.id,
      metadata: { number: discrepancy.number, type: discrepancy.type, origin: discrepancy.origin, movementId },
    });
    return discrepancy.id;
  });
  return getDiscrepancy(actor, discrepancyId);
}

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------

export async function changeDiscrepancyStatus(actor: Actor, discrepancyId: string, input: DiscrepancyStatusChangeInput, context: RequestContext) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "discrepancies" WHERE "id" = ${discrepancyId}::uuid FOR UPDATE`;
    const current = await tx.discrepancy.findUnique({ where: { id: discrepancyId } });
    if (!current) throw new NotFoundError('Divergência não encontrada.');

    const problems = validateStatusTransition(current, input);
    if (problems.length > 0) throw new BusinessRuleError('INVALID_STATUS_TRANSITION', problems.join(' '), { problems });

    const now = new Date();
    await tx.discrepancy.update({
      where: { id: discrepancyId },
      data: {
        status: input.status,
        ...(input.status === 'IN_ANALYSIS' ? { analysisStartedAt: now, assignedToId: current.assignedToId ?? actor.userId } : {}),
        ...(FINAL_DISCREPANCY_STATUSES.includes(input.status) ? { resolvedAt: now } : {}),
        ...(input.correctiveAction ? { correctiveAction: input.correctiveAction } : {}),
        ...(input.probableCause ? { probableCause: input.probableCause } : {}),
      },
    });

    const note = [
      input.note,
      input.probableCause ? `Causa provável: ${PROBABLE_CAUSE_LABEL[input.probableCause]}` : null,
      input.correctiveAction ? `Ação corretiva: ${input.correctiveAction}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    await tx.discrepancyAction.create({
      data: { discrepancyId, userId: actor.userId, kind: 'STATUS_CHANGE', fromStatus: current.status, toStatus: input.status, note: note || null },
    });
    await writeAudit(tx, context, {
      action: 'discrepancies.status_change',
      result: 'SUCCESS',
      entityType: 'Discrepancy',
      entityId: discrepancyId,
      metadata: { number: current.number, from: current.status, to: input.status, probableCause: input.probableCause ?? null },
    });
  });
  return getDiscrepancy(actor, discrepancyId);
}

export async function assignDiscrepancy(actor: Actor, discrepancyId: string, assignedToId: string | null, context: RequestContext) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const current = await tx.discrepancy.findUnique({ where: { id: discrepancyId }, select: { number: true, status: true, assignedToId: true } });
    if (!current) throw new NotFoundError('Divergência não encontrada.');
    if (FINAL_DISCREPANCY_STATUSES.includes(current.status)) throw new ConflictError('Divergência finalizada não pode ser reatribuída.', 'DISCREPANCY_FINALIZED');

    let assigneeName: string | null = null;
    if (assignedToId) {
      const assignee = await tx.user.findUnique({ where: { id: assignedToId }, select: { name: true, active: true, roleId: true } });
      const canAnalyze = assignee
        ? await tx.rolePermission.findFirst({ where: { roleId: assignee.roleId, permission: { code: 'discrepancies.manage' } }, select: { roleId: true } })
        : null;
      if (!assignee?.active || !canAnalyze) {
        throw new BusinessRuleError('ASSIGNEE_INVALID', 'O responsável precisa ser um usuário ativo com permissão para analisar divergências.');
      }
      assigneeName = assignee.name;
    }

    await tx.discrepancy.update({ where: { id: discrepancyId }, data: { assignedToId } });
    await tx.discrepancyAction.create({
      data: { discrepancyId, userId: actor.userId, kind: 'ASSIGNMENT', note: assigneeName ? `Responsável: ${assigneeName}` : 'Responsável removido' },
    });
    await writeAudit(tx, context, {
      action: 'discrepancies.assign',
      result: 'SUCCESS',
      entityType: 'Discrepancy',
      entityId: discrepancyId,
      metadata: { number: current.number, from: current.assignedToId, to: assignedToId },
    });
  });
  return getDiscrepancy(actor, discrepancyId);
}

/** Comentários permitem que o operador explique o contexto — inclusive após a finalização. */
export async function commentDiscrepancy(actor: Actor, discrepancyId: string, note: string, context: RequestContext) {
  const prisma = getPrisma();
  const discrepancy = await findVisible(prisma, actor, discrepancyId);
  await prisma.$transaction(async (tx) => {
    await tx.discrepancyAction.create({ data: { discrepancyId, userId: actor.userId, kind: 'COMMENT', note } });
    await writeAudit(tx, context, { action: 'discrepancies.comment', result: 'SUCCESS', entityType: 'Discrepancy', entityId: discrepancyId, metadata: { number: discrepancy.number } });
  });
  return getDiscrepancy(actor, discrepancyId);
}

// ---------------------------------------------------------------------------
// Evidências
// ---------------------------------------------------------------------------

export async function addEvidence(actor: Actor, discrepancyId: string, file: { filename: string; buffer: Buffer }, context: RequestContext) {
  const prisma = getPrisma();
  const discrepancy = await findVisible(prisma, actor, discrepancyId);
  if (FINAL_DISCREPANCY_STATUSES.includes(discrepancy.status)) {
    throw new ConflictError('Não é possível anexar evidências a uma divergência finalizada.', 'DISCREPANCY_FINALIZED');
  }
  if (discrepancy._count.evidences >= MAX_EVIDENCES) {
    throw new BusinessRuleError('EVIDENCE_LIMIT', `Limite de ${MAX_EVIDENCES} evidências por divergência atingido.`);
  }

  const stored = await storeEvidenceFile(file.buffer);
  const originalName = sanitizeFileName(file.filename);
  return prisma.$transaction(async (tx) => {
    const evidence = await tx.discrepancyEvidence.create({
      data: { discrepancyId, uploadedById: actor.userId, originalName, ...stored },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
    await tx.discrepancyAction.create({ data: { discrepancyId, userId: actor.userId, kind: 'EVIDENCE_ADDED', note: originalName } });
    await writeAudit(tx, context, {
      action: 'discrepancies.evidence_add',
      result: 'SUCCESS',
      entityType: 'DiscrepancyEvidence',
      entityId: evidence.id,
      metadata: { discrepancyNumber: discrepancy.number, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
    });
    return evidence;
  });
}

export async function getEvidenceFile(actor: Actor, discrepancyId: string, evidenceId: string) {
  const prisma = getPrisma();
  await findVisible(prisma, actor, discrepancyId);
  const evidence = await prisma.discrepancyEvidence.findFirst({ where: { id: evidenceId, discrepancyId } });
  if (!evidence) throw new NotFoundError('Evidência não encontrada.');
  return { buffer: await readEvidenceFile(evidence.storageKey), mimeType: evidence.mimeType, fileName: evidence.originalName };
}
