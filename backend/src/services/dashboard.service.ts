import { getEnv } from '../config/env.js';
import { getPrisma, Prisma } from '../lib/prisma.js';
import { DISCREPANCY_TYPE_LABEL } from '../utils/labels.js';
import type { DashboardQuery, ReportSummaryQuery } from '../validators/analytics.schemas.js';
import { countOpenAlerts } from './alert.service.js';
import {
  discrepancyRate,
  percentChange,
  previousPeriod,
  resolvePeriod,
  toFloat,
  toInt,
  type Period,
} from './analytics-period.js';

/**
 * Indicadores gerenciais. Todas as consultas são parametrizadas (Prisma.sql);
 * nenhum valor do usuário é concatenado em SQL. Definições em docs/metricas.md.
 */
export interface Scope {
  warehouseId?: string | undefined;
  sectorId?: string | undefined;
}

/** Filtro de movimentações por armazém e por setor (algum item passa pelo setor). */
function movementScope(scope: Scope) {
  return Prisma.sql`
    ${scope.warehouseId ? Prisma.sql`AND m."warehouseId" = ${scope.warehouseId}::uuid` : Prisma.empty}
    ${scope.sectorId
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "stock_movement_items" si
            JOIN "locations" sl ON sl."id" IN (si."fromLocationId", si."toLocationId")
           WHERE si."movementId" = m."id" AND sl."sectorId" = ${scope.sectorId}::uuid)`
      : Prisma.empty}`;
}

/** Filtro de divergências pelo endereço (alias l = locations). */
function discrepancyScope(scope: Scope) {
  return Prisma.sql`
    ${scope.warehouseId ? Prisma.sql`AND l."warehouseId" = ${scope.warehouseId}::uuid` : Prisma.empty}
    ${scope.sectorId ? Prisma.sql`AND l."sectorId" = ${scope.sectorId}::uuid` : Prisma.empty}`;
}

export interface PeriodMetrics {
  confirmedMovements: number;
  analyzedOperations: number;
  operationsWithDiscrepancy: number;
  discrepancyRate: number | null;
  discrepancies: number;
  discardedDiscrepancies: number;
  estimatedValue: number;
  discrepanciesWithoutValue: number;
}

export async function periodMetrics(period: Period, scope: Scope): Promise<PeriodMetrics> {
  const prisma = getPrisma();
  const [movements] = await prisma.$queryRaw<Array<{ confirmed: bigint; analyzed: bigint; withDiscrepancy: bigint }>>`
    SELECT
      (SELECT count(*) FROM "stock_movements" m
        WHERE m."status" = 'CONFIRMED' AND m."confirmedAt" >= ${period.from} AND m."confirmedAt" < ${period.to}
        ${movementScope(scope)}) AS "confirmed",
      (SELECT count(*) FROM "stock_movements" m
        WHERE m."checkStartedAt" >= ${period.from} AND m."checkStartedAt" < ${period.to}
        ${movementScope(scope)}) AS "analyzed",
      (SELECT count(*) FROM "stock_movements" m
        WHERE m."checkStartedAt" >= ${period.from} AND m."checkStartedAt" < ${period.to}
          AND EXISTS (SELECT 1 FROM "discrepancies" d WHERE d."movementId" = m."id" AND d."status" <> 'DISCARDED')
        ${movementScope(scope)}) AS "withDiscrepancy"`;

  const [discrepancies] = await prisma.$queryRaw<Array<{ valid: bigint; discarded: bigint; value: Prisma.Decimal | null; withoutValue: bigint }>>`
    SELECT
      count(*) FILTER (WHERE d."status" <> 'DISCARDED') AS "valid",
      count(*) FILTER (WHERE d."status" = 'DISCARDED') AS "discarded",
      COALESCE(sum(d."estimatedValue") FILTER (WHERE d."status" <> 'DISCARDED'), 0) AS "value",
      count(*) FILTER (WHERE d."status" <> 'DISCARDED' AND d."estimatedValue" IS NULL) AS "withoutValue"
    FROM "discrepancies" d
    LEFT JOIN "locations" l ON l."id" = d."locationId"
    WHERE d."createdAt" >= ${period.from} AND d."createdAt" < ${period.to}
    ${discrepancyScope(scope)}`;

  const analyzed = toInt(movements?.analyzed);
  const withDiscrepancy = toInt(movements?.withDiscrepancy);
  return {
    confirmedMovements: toInt(movements?.confirmed),
    analyzedOperations: analyzed,
    operationsWithDiscrepancy: withDiscrepancy,
    discrepancyRate: discrepancyRate(withDiscrepancy, analyzed),
    discrepancies: toInt(discrepancies?.valid),
    discardedDiscrepancies: toInt(discrepancies?.discarded),
    estimatedValue: toFloat(discrepancies?.value) ?? 0,
    discrepanciesWithoutValue: toInt(discrepancies?.withoutValue),
  };
}

export async function discrepanciesByType(period: Period, scope: Scope) {
  const rows = await getPrisma().$queryRaw<Array<{ type: keyof typeof DISCREPANCY_TYPE_LABEL; count: bigint }>>`
    SELECT d."type"::text AS "type", count(*) AS "count"
    FROM "discrepancies" d
    LEFT JOIN "locations" l ON l."id" = d."locationId"
    WHERE d."status" <> 'DISCARDED' AND d."createdAt" >= ${period.from} AND d."createdAt" < ${period.to}
    ${discrepancyScope(scope)}
    GROUP BY d."type"
    ORDER BY count(*) DESC`;
  const total = rows.reduce((sum, row) => sum + toInt(row.count), 0);
  return rows.map((row) => ({
    type: row.type,
    label: DISCREPANCY_TYPE_LABEL[row.type],
    count: toInt(row.count),
    share: total > 0 ? Math.round((toInt(row.count) / total) * 1000) / 10 : 0,
  }));
}

async function topProducts(period: Period, scope: Scope) {
  const rows = await getPrisma().$queryRaw<Array<{ id: string; internalCode: string; name: string; count: bigint; value: Prisma.Decimal | null }>>`
    SELECT p."id", p."internalCode", p."name", count(*) AS "count", COALESCE(sum(d."estimatedValue"), 0) AS "value"
    FROM "discrepancies" d
    JOIN "products" p ON p."id" = d."productId"
    LEFT JOIN "locations" l ON l."id" = d."locationId"
    WHERE d."status" <> 'DISCARDED' AND d."createdAt" >= ${period.from} AND d."createdAt" < ${period.to}
    ${discrepancyScope(scope)}
    GROUP BY p."id"
    ORDER BY count(*) DESC, "value" DESC
    LIMIT 5`;
  return rows.map((row) => ({ id: row.id, internalCode: row.internalCode, name: row.name, count: toInt(row.count), estimatedValue: toFloat(row.value) ?? 0 }));
}

async function topSectors(period: Period, scope: Scope) {
  const rows = await getPrisma().$queryRaw<Array<{ id: string; code: string; name: string; count: bigint }>>`
    SELECT s."id", s."code", s."name", count(*) AS "count"
    FROM "discrepancies" d
    JOIN "locations" l ON l."id" = d."locationId"
    JOIN "sectors" s ON s."id" = l."sectorId"
    WHERE d."status" <> 'DISCARDED' AND d."createdAt" >= ${period.from} AND d."createdAt" < ${period.to}
    ${discrepancyScope(scope)}
    GROUP BY s."id"
    ORDER BY count(*) DESC
    LIMIT 5`;
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, count: toInt(row.count) }));
}

/** Série temporal com todos os intervalos (inclusive os sem ocorrências), no fuso da empresa. */
async function timeSeries(period: Period, scope: Scope, granularity: DashboardQuery['granularity']) {
  const tz = getEnv().APP_TIMEZONE;
  const rows = await getPrisma().$queryRaw<Array<{ bucket: string; movements: bigint; analyzed: bigint; withDiscrepancy: bigint; discrepancies: bigint }>>`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${granularity}, ${period.from}::timestamptz AT TIME ZONE ${tz}),
        date_trunc(${granularity}, ${period.to}::timestamptz AT TIME ZONE ${tz}),
        ('1 ' || ${granularity})::interval
      ) AS "bucket"
    ),
    mov AS (
      SELECT date_trunc(${granularity}, m."confirmedAt" AT TIME ZONE ${tz}) AS "bucket", count(*) AS "c"
      FROM "stock_movements" m
      WHERE m."status" = 'CONFIRMED' AND m."confirmedAt" >= ${period.from} AND m."confirmedAt" < ${period.to}
      ${movementScope(scope)}
      GROUP BY 1
    ),
    ana AS (
      SELECT date_trunc(${granularity}, m."checkStartedAt" AT TIME ZONE ${tz}) AS "bucket",
             count(*) AS "c",
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "discrepancies" d WHERE d."movementId" = m."id" AND d."status" <> 'DISCARDED')) AS "withD"
      FROM "stock_movements" m
      WHERE m."checkStartedAt" >= ${period.from} AND m."checkStartedAt" < ${period.to}
      ${movementScope(scope)}
      GROUP BY 1
    ),
    dis AS (
      SELECT date_trunc(${granularity}, d."createdAt" AT TIME ZONE ${tz}) AS "bucket", count(*) AS "c"
      FROM "discrepancies" d
      LEFT JOIN "locations" l ON l."id" = d."locationId"
      WHERE d."status" <> 'DISCARDED' AND d."createdAt" >= ${period.from} AND d."createdAt" < ${period.to}
      ${discrepancyScope(scope)}
      GROUP BY 1
    )
    SELECT to_char(b."bucket", 'YYYY-MM-DD') AS "bucket",
           COALESCE(mov."c", 0) AS "movements",
           COALESCE(ana."c", 0) AS "analyzed",
           COALESCE(ana."withD", 0) AS "withDiscrepancy",
           COALESCE(dis."c", 0) AS "discrepancies"
    FROM buckets b
    LEFT JOIN mov ON mov."bucket" = b."bucket"
    LEFT JOIN ana ON ana."bucket" = b."bucket"
    LEFT JOIN dis ON dis."bucket" = b."bucket"
    ORDER BY b."bucket"`;

  return rows.map((row) => {
    const analyzed = toInt(row.analyzed);
    const withDiscrepancy = toInt(row.withDiscrepancy);
    return {
      bucket: row.bucket,
      movements: toInt(row.movements),
      analyzedOperations: analyzed,
      operationsWithDiscrepancy: withDiscrepancy,
      discrepancies: toInt(row.discrepancies),
      discrepancyRate: discrepancyRate(withDiscrepancy, analyzed),
    };
  });
}

async function resolutionTime(period: Period, scope: Scope) {
  const [row] = await getPrisma().$queryRaw<Array<{ avgHours: number | null; count: bigint }>>`
    SELECT avg(EXTRACT(EPOCH FROM (d."resolvedAt" - d."createdAt")) / 3600)::float8 AS "avgHours", count(*) AS "count"
    FROM "discrepancies" d
    LEFT JOIN "locations" l ON l."id" = d."locationId"
    WHERE d."status" IN ('CORRECTED', 'CONFIRMED') AND d."resolvedAt" >= ${period.from} AND d."resolvedAt" < ${period.to}
    ${discrepancyScope(scope)}`;
  return {
    averageHours: row?.avgHours == null ? null : Math.round(row.avgHours * 10) / 10,
    resolvedCount: toInt(row?.count),
  };
}

async function pendingOperations(scope: Scope) {
  const groups = await getPrisma().stockMovement.groupBy({
    by: ['status'],
    where: { status: { in: ['PENDING_CHECK', 'PENDING_APPROVAL'] }, ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}) },
    _count: { _all: true },
    _min: { createdAt: true },
  });
  const byStatus = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
  const oldest = groups
    .map((group) => group._min.createdAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    pendingCheck: byStatus.PENDING_CHECK ?? 0,
    pendingApproval: byStatus.PENDING_APPROVAL ?? 0,
    total: (byStatus.PENDING_CHECK ?? 0) + (byStatus.PENDING_APPROVAL ?? 0),
    oldestCreatedAt: oldest ?? null,
  };
}

export async function getDashboard(query: DashboardQuery) {
  const period = resolvePeriod(query.from, query.to);
  const scope: Scope = { warehouseId: query.warehouseId, sectorId: query.sectorId };
  const previous = previousPeriod(period);

  const [current, before, byType, products, sectors, series, resolution, pending, alerts] = await Promise.all([
    periodMetrics(period, scope),
    periodMetrics(previous, scope),
    discrepanciesByType(period, scope),
    topProducts(period, scope),
    topSectors(period, scope),
    timeSeries(period, scope, query.granularity),
    resolutionTime(period, scope),
    pendingOperations(scope),
    countOpenAlerts(),
  ]);

  return {
    period: { from: period.from, to: period.to, granularity: query.granularity },
    previousPeriod: previous,
    metrics: current,
    comparison: {
      confirmedMovements: percentChange(current.confirmedMovements, before.confirmedMovements),
      discrepancies: percentChange(current.discrepancies, before.discrepancies),
      estimatedValue: percentChange(current.estimatedValue, before.estimatedValue),
      // Diferença em pontos percentuais (não variação relativa) — evita leitura enganosa.
      discrepancyRatePoints:
        current.discrepancyRate !== null && before.discrepancyRate !== null
          ? Math.round((current.discrepancyRate - before.discrepancyRate) * 100) / 100
          : null,
    },
    discrepanciesByType: byType,
    topProducts: products,
    topSectors: sectors,
    series,
    resolution,
    pending,
    openAlerts: alerts,
    definitions: {
      discrepancyRate: 'Operações conferidas no período com ao menos uma divergência não descartada ÷ operações conferidas no período × 100.',
      estimatedValue: 'Soma de |esperado − encontrado| × custo unitário de referência das divergências não descartadas. Divergências sem custo cadastrado não entram no valor.',
    },
  };
}

export async function getReportSummary(query: ReportSummaryQuery) {
  const period = resolvePeriod(query.from, query.to);
  const scope: Scope = { warehouseId: query.warehouseId, sectorId: query.sectorId };
  const [metrics, byType] = await Promise.all([periodMetrics(period, scope), discrepanciesByType(period, scope)]);
  return { period, metrics, discrepanciesByType: byType };
}
