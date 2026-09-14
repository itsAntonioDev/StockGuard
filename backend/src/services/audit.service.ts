import { createHmac } from 'node:crypto';
import { getEnv } from '../config/env.js';
import type { AuditResult } from '../generated/prisma/enums.js';
import { getPrisma, Prisma, type DbClient, type TxClient } from '../lib/prisma.js';
import { canonicalJson } from '../utils/canonical-json.js';
import { redactSensitive } from '../utils/redact.js';
import type { RequestContext } from '../utils/request-context.js';

/**
 * Auditoria à prova de adulteração:
 * - tabela somente-inserção (privilégios + trigger no banco);
 * - cada registro guarda HMAC(prevHash + conteúdo), formando uma cadeia.
 *   Alterar/remover um registro quebra a verificação dos seguintes.
 * A chave HMAC fica fora do banco (AUDIT_HMAC_KEY).
 */
const AUDIT_CHAIN_LOCK = 7_210_001;

export interface AuditEntry {
  action: string;
  result: AuditResult;
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
}

interface HashableRecord {
  createdAt: string;
  requestId: string | null;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
}

export function computeAuditHash(prevHash: string | null, record: HashableRecord, keyBase64: string): string {
  return createHmac('sha256', Buffer.from(keyBase64, 'base64'))
    .update(`${prevHash ?? ''}|${canonicalJson(record)}`)
    .digest('hex');
}

async function insertAudit(tx: TxClient, context: Partial<RequestContext>, entry: AuditEntry): Promise<void> {
  // Serializa a escrita da cadeia; o lock é liberado no fim da transação.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
  const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });

  const metadata = entry.metadata === undefined ? null : (JSON.parse(JSON.stringify(redactSensitive(entry.metadata))) as unknown);
  const record: HashableRecord = {
    createdAt: new Date().toISOString(),
    requestId: context.requestId ?? null,
    actorId: context.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    result: entry.result,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
    metadata,
  };
  const prevHash = last?.hash ?? null;

  await tx.auditLog.create({
    data: {
      ...record,
      createdAt: new Date(record.createdAt),
      result: entry.result,
      metadata: metadata === null ? Prisma.DbNull : (metadata as Prisma.InputJsonValue),
      prevHash,
      hash: computeAuditHash(prevHash, record, getEnv().AUDIT_HMAC_KEY),
    },
  });
}

/**
 * Registra um evento. Dentro de uma transação, o registro é confirmado junto
 * com a operação (ou desfeito com ela). Fora, usa uma transação própria.
 */
export async function writeAudit(db: DbClient, context: Partial<RequestContext>, entry: AuditEntry): Promise<void> {
  if ('$transaction' in db) {
    await db.$transaction((tx) => insertAudit(tx, context, entry));
  } else {
    await insertAudit(db, context, entry);
  }
}

/** Registro de falhas/negações que nunca deve derrubar a requisição original. */
export async function writeAuditSafe(context: Partial<RequestContext>, entry: AuditEntry, log?: { error: (obj: unknown, msg: string) => void }): Promise<void> {
  try {
    await writeAudit(getPrisma(), context, entry);
  } catch (error) {
    log?.error({ err: error, action: entry.action }, 'Falha ao gravar auditoria');
  }
}

export interface AuditChainVerification {
  valid: boolean;
  checked: number;
  firstInvalidId: string | null;
}

export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const prisma = getPrisma();
  const key = getEnv().AUDIT_HMAC_KEY;
  let cursor: bigint | undefined;
  let previousHash: string | null = null;
  let checked = 0;

  for (;;) {
    const batch = await prisma.auditLog.findMany({
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      const expected = computeAuditHash(
        previousHash,
        {
          createdAt: row.createdAt.toISOString(),
          requestId: row.requestId,
          actorId: row.actorId,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          result: row.result,
          ip: row.ip,
          userAgent: row.userAgent,
          metadata: row.metadata ?? null,
        },
        key,
      );
      if (row.prevHash !== previousHash || row.hash !== expected) {
        return { valid: false, checked, firstInvalidId: row.id.toString() };
      }
      previousHash = row.hash;
      checked += 1;
    }
    cursor = batch[batch.length - 1]!.id;
  }

  return { valid: true, checked, firstInvalidId: null };
}
