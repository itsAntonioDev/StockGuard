import { getPrisma, Prisma } from '../lib/prisma.js';
import type { AuditListQuery } from '../validators/admin.schemas.js';
import { skipTake, toPage } from '../validators/common.js';

export async function listAuditLogs(query: AuditListQuery) {
  const prisma = getPrisma();
  const where: Prisma.AuditLogWhereInput = {
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.result ? { result: query.result } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      ...skipTake(query.page, query.pageSize),
      select: {
        id: true,
        createdAt: true,
        requestId: true,
        action: true,
        entityType: true,
        entityId: true,
        result: true,
        ip: true,
        userAgent: true,
        metadata: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);
  return toPage(rows.map((row) => ({ ...row, id: row.id.toString() })), total, query.page, query.pageSize);
}
