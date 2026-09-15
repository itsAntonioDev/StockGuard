import { getEnv } from '../config/env.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma } from '../lib/prisma.js';
import type { Actor } from '../types/fastify.js';
import { MOVEMENT_TYPE_LABEL } from '../utils/labels.js';
import type { ProductivityQuery } from '../validators/analytics.schemas.js';
import { resolvePeriod, toFloat, toInt, type Period } from './analytics-period.js';
import { getSetting } from './settings.service.js';

/**
 * Produtividade orientada a MELHORIA DE PROCESSO:
 * - não existe ranking de pessoas nem lista ordenada por erros;
 * - indicadores vêm acompanhados de contexto (tipo de operação, itens, quantidade,
 *   classe de manuseio, tempo de treinamento);
 * - com amostra pequena, nenhum indicador conclusivo ou sugestão é exibido;
 * - sugestões falam de treinamento, sinalização e cadastro — nunca de punição.
 */

interface Filters {
  period: Period;
  warehouseId?: string | undefined;
  sectorId?: string | undefined;
  userId?: string | undefined;
}

/** Endereço onde o item é conferido (destino na entrada, origem nas demais). */
const CHECK_LOCATION_JOIN = Prisma.sql`
  JOIN "locations" l ON l."id" = CASE WHEN m."type" = 'ENTRY' THEN i."toLocationId" ELSE COALESCE(i."fromLocationId", i."toLocationId") END`;

function attemptScope(filters: Filters) {
  return Prisma.sql`
    ${filters.warehouseId ? Prisma.sql`AND l."warehouseId" = ${filters.warehouseId}::uuid` : Prisma.empty}
    ${filters.sectorId ? Prisma.sql`AND l."sectorId" = ${filters.sectorId}::uuid` : Prisma.empty}
    ${filters.userId ? Prisma.sql`AND a."userId" = ${filters.userId}::uuid` : Prisma.empty}`;
}

function checkedMovementScope(filters: Filters) {
  return Prisma.sql`
    ${filters.warehouseId ? Prisma.sql`AND m."warehouseId" = ${filters.warehouseId}::uuid` : Prisma.empty}
    ${filters.sectorId
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "stock_movement_items" si
            JOIN "locations" sl ON sl."id" IN (si."fromLocationId", si."toLocationId")
           WHERE si."movementId" = m."id" AND sl."sectorId" = ${filters.sectorId}::uuid)`
      : Prisma.empty}
    ${filters.userId ? Prisma.sql`AND m."checkedById" = ${filters.userId}::uuid` : Prisma.empty}`;
}

// ---------------------------------------------------------------------------
// Sugestões de treinamento (função pura, testada isoladamente)
// ---------------------------------------------------------------------------

const SUGGESTION_RULES: Array<{ codes: string[]; threshold: number; message: string }> = [
  {
    codes: ['WRONG_LOCATION', 'WRONG_DESTINATION'],
    threshold: 0.3,
    message: 'Leituras de endereço incorretas são frequentes: revise a sinalização física e reforce o procedimento de leitura da etiqueta do endereço.',
  },
  {
    codes: ['WRONG_PRODUCT', 'PRODUCT_NOT_FOUND'],
    threshold: 0.3,
    message: 'Produtos trocados ou códigos não reconhecidos: revise etiquetas e códigos de barras cadastrados e treine a identificação de itens semelhantes.',
  },
  {
    codes: ['QUANTITY_MISMATCH'],
    threshold: 0.3,
    message: 'Diferenças de quantidade recorrentes: revise o método de contagem (embalagens múltiplas, caixas fechadas) e a unidade de medida dos produtos.',
  },
  {
    codes: ['WRONG_LOT', 'LOT_REQUIRED'],
    threshold: 0.2,
    message: 'Erros de lote: reforce o treinamento de controle de lote e validade (FEFO) e a posição da etiqueta de lote nas embalagens.',
  },
  {
    codes: ['INVALID_QUANTITY_FOR_UNIT'],
    threshold: 0.1,
    message: 'Quantidades fracionadas em unidades inteiras: revise a unidade de medida no cadastro e como ela aparece na embalagem.',
  },
];

export interface TrainingSuggestion {
  codes: string[];
  share: number;
  message: string;
}

export function buildTrainingSuggestions(errorCounts: Record<string, number>, attempts: number, minSample: number): TrainingSuggestion[] {
  if (attempts < minSample) return [];
  const totalErrors = Object.values(errorCounts).reduce((sum, count) => sum + count, 0);
  if (totalErrors === 0) return [];
  return SUGGESTION_RULES.flatMap((rule) => {
    const count = rule.codes.reduce((sum, code) => sum + (errorCounts[code] ?? 0), 0);
    const share = count / totalErrors;
    return share >= rule.threshold ? [{ codes: rule.codes, share: Math.round(share * 1000) / 10, message: rule.message }] : [];
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

async function byOperationType(filters: Filters, minSample: number) {
  const rows = await getPrisma().$queryRaw<
    Array<{ type: keyof typeof MOVEMENT_TYPE_LABEL; operations: bigint; avgMinutes: number | null; avgItems: number | null; avgQuantity: number | null; avgMinutesPerItem: number | null; firstPassOk: bigint; mismatches: bigint; activeHours: bigint }>
  >`
    WITH checked AS (
      SELECT m."id", m."type", m."checkedAt",
             EXTRACT(EPOCH FROM (m."checkedAt" - m."checkStartedAt")) / 60 AS "minutes",
             (SELECT count(*) FROM "stock_movement_items" i WHERE i."movementId" = m."id") AS "items",
             (SELECT COALESCE(sum(i."expectedQuantity"), 0) FROM "stock_movement_items" i WHERE i."movementId" = m."id") AS "quantity",
             (SELECT count(*) FROM "check_attempts" a WHERE a."movementId" = m."id" AND a."result" = 'MISMATCH') AS "mismatches"
      FROM "stock_movements" m
      WHERE m."status" = 'CONFIRMED' AND m."checkedAt" IS NOT NULL AND m."checkStartedAt" IS NOT NULL
        AND m."checkedAt" >= ${filters.period.from} AND m."checkedAt" < ${filters.period.to}
        ${checkedMovementScope(filters)}
    )
    SELECT "type"::text AS "type",
           count(*) AS "operations",
           avg("minutes")::float8 AS "avgMinutes",
           avg("items")::float8 AS "avgItems",
           avg("quantity")::float8 AS "avgQuantity",
           avg("minutes" / NULLIF("items", 0))::float8 AS "avgMinutesPerItem",
           count(*) FILTER (WHERE "mismatches" = 0) AS "firstPassOk",
           COALESCE(sum("mismatches"), 0) AS "mismatches",
           count(DISTINCT date_trunc('hour', "checkedAt")) AS "activeHours"
    FROM checked
    GROUP BY "type"
    ORDER BY "type"`;

  const round = (value: number | null, digits = 1) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
  return rows.map((row) => {
    const operations = toInt(row.operations);
    const sufficient = operations >= minSample;
    return {
      type: row.type,
      label: MOVEMENT_TYPE_LABEL[row.type],
      operations,
      sufficientSample: sufficient,
      // Contexto de complexidade — sempre exibido junto com os tempos.
      averageItems: round(row.avgItems),
      averageQuantity: round(row.avgQuantity),
      averageMinutes: round(row.avgMinutes),
      averageMinutesPerItem: round(row.avgMinutesPerItem, 2),
      operationsPerActiveHour: toInt(row.activeHours) > 0 ? round(operations / toInt(row.activeHours)) : null,
      firstPassAccuracy: operations > 0 ? round((toInt(row.firstPassOk) / operations) * 100) : null,
      reworkPerOperation: operations > 0 ? round(toInt(row.mismatches) / operations, 2) : null,
    };
  });
}

async function bySector(filters: Filters, minSample: number) {
  const prisma = getPrisma();
  const attempts = await prisma.$queryRaw<Array<{ id: string; code: string; name: string; attempts: bigint; matches: bigint }>>`
    SELECT s."id", s."code", s."name", count(*) AS "attempts", count(*) FILTER (WHERE a."result" = 'MATCH') AS "matches"
    FROM "check_attempts" a
    JOIN "stock_movements" m ON m."id" = a."movementId"
    JOIN "stock_movement_items" i ON i."id" = a."movementItemId"
    ${CHECK_LOCATION_JOIN}
    JOIN "sectors" s ON s."id" = l."sectorId"
    WHERE a."createdAt" >= ${filters.period.from} AND a."createdAt" < ${filters.period.to}
    ${attemptScope(filters)}
    GROUP BY s."id"
    ORDER BY s."code"`;

  const errors = await prisma.$queryRaw<Array<{ sectorId: string; code: string; count: bigint }>>`
    SELECT l."sectorId" AS "sectorId", e."code" AS "code", count(*) AS "count"
    FROM "check_attempts" a
    JOIN "stock_movements" m ON m."id" = a."movementId"
    JOIN "stock_movement_items" i ON i."id" = a."movementItemId"
    ${CHECK_LOCATION_JOIN}
    CROSS JOIN LATERAL jsonb_array_elements_text(a."errorCodes") AS e("code")
    WHERE a."result" = 'MISMATCH' AND a."createdAt" >= ${filters.period.from} AND a."createdAt" < ${filters.period.to}
    ${attemptScope(filters)}
    GROUP BY l."sectorId", e."code"`;

  const resolution = await prisma.$queryRaw<Array<{ sectorId: string; avgHours: number | null; resolved: bigint }>>`
    SELECT l."sectorId" AS "sectorId", avg(EXTRACT(EPOCH FROM (d."resolvedAt" - d."createdAt")) / 3600)::float8 AS "avgHours", count(*) AS "resolved"
    FROM "discrepancies" d
    JOIN "locations" l ON l."id" = d."locationId"
    WHERE d."status" IN ('CORRECTED', 'CONFIRMED') AND d."resolvedAt" >= ${filters.period.from} AND d."resolvedAt" < ${filters.period.to}
    ${filters.warehouseId ? Prisma.sql`AND l."warehouseId" = ${filters.warehouseId}::uuid` : Prisma.empty}
    ${filters.sectorId ? Prisma.sql`AND l."sectorId" = ${filters.sectorId}::uuid` : Prisma.empty}
    GROUP BY l."sectorId"`;

  const errorsBySector = new Map<string, Record<string, number>>();
  for (const row of errors) {
    const entry = errorsBySector.get(row.sectorId) ?? {};
    entry[row.code] = toInt(row.count);
    errorsBySector.set(row.sectorId, entry);
  }
  const resolutionBySector = new Map(resolution.map((row) => [row.sectorId, row]));

  return attempts.map((row) => {
    const total = toInt(row.attempts);
    const errorMix = errorsBySector.get(row.id) ?? {};
    const res = resolutionBySector.get(row.id);
    return {
      sector: { id: row.id, code: row.code, name: row.name },
      attempts: total,
      sufficientSample: total >= minSample,
      attemptAccuracy: total > 0 ? Math.round((toInt(row.matches) / total) * 1000) / 10 : null,
      errorMix,
      averageResolutionHours: res?.avgHours == null ? null : Math.round(res.avgHours * 10) / 10,
      resolvedDiscrepancies: toInt(res?.resolved),
      suggestions: buildTrainingSuggestions(errorMix, total, minSample),
    };
  });
}

async function weeklyEvolution(filters: Filters) {
  const tz = getEnv().APP_TIMEZONE;
  const rows = await getPrisma().$queryRaw<Array<{ week: string; sectorCode: string; attempts: bigint; matches: bigint }>>`
    SELECT to_char(date_trunc('week', a."createdAt" AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS "week",
           s."code" AS "sectorCode",
           count(*) AS "attempts",
           count(*) FILTER (WHERE a."result" = 'MATCH') AS "matches"
    FROM "check_attempts" a
    JOIN "stock_movements" m ON m."id" = a."movementId"
    JOIN "stock_movement_items" i ON i."id" = a."movementItemId"
    ${CHECK_LOCATION_JOIN}
    JOIN "sectors" s ON s."id" = l."sectorId"
    WHERE a."createdAt" >= ${filters.period.from} AND a."createdAt" < ${filters.period.to}
    ${attemptScope(filters)}
    GROUP BY 1, s."code"
    ORDER BY 1, s."code"`;
  return rows.map((row) => ({
    week: row.week,
    sectorCode: row.sectorCode,
    attempts: toInt(row.attempts),
    attemptAccuracy: toInt(row.attempts) > 0 ? Math.round((toInt(row.matches) / toInt(row.attempts)) * 1000) / 10 : null,
  }));
}

async function inventoryRework(filters: Filters) {
  const [row] = await getPrisma().$queryRaw<Array<{ counted: bigint; recounts: bigint }>>`
    SELECT count(*) AS "counted", count(*) FILTER (WHERE ii."recountQuantity" IS NOT NULL) AS "recounts"
    FROM "inventory_count_items" ii
    JOIN "locations" l ON l."id" = ii."locationId"
    WHERE ii."countedAt" >= ${filters.period.from} AND ii."countedAt" < ${filters.period.to}
    ${filters.warehouseId ? Prisma.sql`AND l."warehouseId" = ${filters.warehouseId}::uuid` : Prisma.empty}
    ${filters.sectorId ? Prisma.sql`AND l."sectorId" = ${filters.sectorId}::uuid` : Prisma.empty}
    ${filters.userId ? Prisma.sql`AND ii."countedById" = ${filters.userId}::uuid` : Prisma.empty}`;
  return { countedItems: toInt(row?.counted), recounts: toInt(row?.recounts) };
}

async function individualContext(userId: string, period: Period) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, trainingStartedAt: true, role: { select: { name: true } }, sector: { select: { code: true, name: true } } },
  });
  if (!user) throw new NotFoundError('Usuário não encontrado.');

  const handling = await prisma.$queryRaw<Array<{ handlingClass: string; operations: bigint }>>`
    SELECT p."handlingClass"::text AS "handlingClass", count(DISTINCT m."id") AS "operations"
    FROM "stock_movements" m
    JOIN "stock_movement_items" i ON i."movementId" = m."id"
    JOIN "products" p ON p."id" = i."productId"
    WHERE m."checkedById" = ${userId}::uuid AND m."checkedAt" >= ${period.from} AND m."checkedAt" < ${period.to}
    GROUP BY p."handlingClass"`;

  return {
    user: { id: user.id, name: user.name, role: user.role.name, sector: user.sector },
    trainingDays: user.trainingStartedAt ? Math.max(0, Math.floor((Date.now() - user.trainingStartedAt.getTime()) / 86_400_000)) : null,
    operationsByHandlingClass: handling.map((row) => ({ handlingClass: row.handlingClass, operations: toInt(row.operations) })),
  };
}

export async function getProductivity(actor: Actor, query: ProductivityQuery) {
  const canSeeAll = actor.permissions.has('productivity.read.all');
  if (!canSeeAll && query.userId && query.userId !== actor.userId) {
    throw new ForbiddenError('Você pode consultar apenas os seus próprios indicadores.');
  }
  const userId = canSeeAll ? query.userId : actor.userId;
  const filters: Filters = { period: resolvePeriod(query.from, query.to), warehouseId: query.warehouseId, sectorId: query.sectorId, userId };
  const minSample = await getSetting('productivity.minSampleSize');

  const [types, sectors, evolution, rework, individual] = await Promise.all([
    byOperationType(filters, minSample),
    bySector(filters, minSample),
    weeklyEvolution(filters),
    inventoryRework(filters),
    userId ? individualContext(userId, filters.period) : Promise.resolve(null),
  ]);

  const errorMix: Record<string, number> = {};
  for (const sector of sectors) {
    for (const [code, count] of Object.entries(sector.errorMix)) errorMix[code] = (errorMix[code] ?? 0) + count;
  }
  const totalAttempts = sectors.reduce((sum, sector) => sum + sector.attempts, 0);

  return {
    period: filters.period,
    scope: userId ? 'INDIVIDUAL' : 'OPERATION',
    minSampleSize: minSample,
    individual,
    byOperationType: types,
    bySector: sectors,
    weeklyEvolution: evolution,
    inventoryRework: rework,
    suggestions: buildTrainingSuggestions(errorMix, totalAttempts, minSample),
    notes: [
      'Indicadores servem para identificar necessidades de treinamento e melhorias de processo, não para comparar pessoas.',
      'Tempos e taxas devem ser lidos junto com o tipo de operação, a quantidade de itens e a classe de manuseio.',
      `Grupos com menos de ${minSample} operações não têm amostra suficiente para conclusões.`,
      'Operações por hora consideram apenas horas com atividade registrada no sistema, não a jornada de trabalho.',
    ],
  };
}

export { toFloat };
