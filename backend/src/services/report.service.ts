import { getEnv } from '../config/env.js';
import { BusinessRuleError } from '../lib/errors.js';
import { getPrisma, Prisma } from '../lib/prisma.js';
import { productIdsBelowMinimum, stockTotalsByProduct } from '../repositories/product.repository.js';
import type { CsvColumn } from '../utils/csv.js';
import {
  DISCREPANCY_ORIGIN_LABEL,
  DISCREPANCY_STATUS_LABEL,
  DISCREPANCY_TYPE_LABEL,
  MOVEMENT_STATUS_LABEL,
  MOVEMENT_TYPE_LABEL,
  PROBABLE_CAUSE_LABEL,
} from '../utils/labels.js';
import { toNumber } from '../utils/quantity.js';
import type { DiscrepancyReportQuery, MovementReportQuery, StockReportQuery } from '../validators/analytics.schemas.js';
import { skipTake, toPage } from '../validators/common.js';
import { resolvePeriod } from './analytics-period.js';

/**
 * Relatórios: a mesma definição (linhas + colunas) alimenta a resposta JSON
 * paginada e a exportação CSV. Um renderizador PDF futuro pode reutilizar
 * `columns` e `fetchAll` sem duplicar consultas — veja docs/integracoes.md.
 */
export const REPORT_MAX_ROWS = 50_000;

export interface ReportDefinition<Row> {
  key: string;
  title: string;
  columns: CsvColumn<Row>[];
}

function dateTime(value: Date | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: getEnv().APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function assertExportable(total: number) {
  if (total > REPORT_MAX_ROWS) {
    throw new BusinessRuleError(
      'REPORT_TOO_LARGE',
      `O relatório tem ${total} linhas; o limite de exportação é ${REPORT_MAX_ROWS}. Reduza o período ou aplique filtros.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Movimentações (uma linha por item)
// ---------------------------------------------------------------------------

const movementItemSelect = {
  id: true,
  expectedQuantity: true,
  quantity: true,
  unit: true,
  product: { select: { internalCode: true, name: true } },
  lot: { select: { code: true } },
  fromLocation: { select: { code: true } },
  toLocation: { select: { code: true } },
  movement: {
    select: {
      number: true,
      type: true,
      status: true,
      referenceDoc: true,
      createdAt: true,
      confirmedAt: true,
      createdBy: { select: { name: true } },
      checkedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.StockMovementItemSelect;

type MovementItemRow = Prisma.StockMovementItemGetPayload<{ select: typeof movementItemSelect }>;

function presentMovementRow(row: MovementItemRow) {
  return {
    number: row.movement.number,
    type: MOVEMENT_TYPE_LABEL[row.movement.type],
    status: MOVEMENT_STATUS_LABEL[row.movement.status],
    createdAt: row.movement.createdAt,
    confirmedAt: row.movement.confirmedAt,
    productCode: row.product.internalCode,
    productName: row.product.name,
    lot: row.lot?.code ?? null,
    expectedQuantity: toNumber(row.expectedQuantity),
    confirmedQuantity: toNumber(row.quantity),
    unit: row.unit,
    from: row.fromLocation?.code ?? null,
    to: row.toLocation?.code ?? null,
    createdBy: row.movement.createdBy.name,
    checkedBy: row.movement.checkedBy?.name ?? null,
    referenceDoc: row.movement.referenceDoc,
  };
}

export type MovementReportRow = ReturnType<typeof presentMovementRow>;

export const movementReport: ReportDefinition<MovementReportRow> = {
  key: 'movimentacoes',
  title: 'Movimentações de estoque',
  columns: [
    { header: 'Nº', value: (r) => r.number },
    { header: 'Tipo', value: (r) => r.type },
    { header: 'Status', value: (r) => r.status },
    { header: 'Criada em', value: (r) => dateTime(r.createdAt) },
    { header: 'Confirmada em', value: (r) => dateTime(r.confirmedAt) },
    { header: 'Código do produto', value: (r) => r.productCode },
    { header: 'Produto', value: (r) => r.productName },
    { header: 'Lote', value: (r) => r.lot },
    { header: 'Qtd. solicitada', value: (r) => r.expectedQuantity },
    { header: 'Qtd. confirmada', value: (r) => r.confirmedQuantity },
    { header: 'Unidade', value: (r) => r.unit },
    { header: 'Origem', value: (r) => r.from },
    { header: 'Destino', value: (r) => r.to },
    { header: 'Registrado por', value: (r) => r.createdBy },
    { header: 'Conferido por', value: (r) => r.checkedBy },
    { header: 'Documento', value: (r) => r.referenceDoc },
  ],
};

function movementWhere(query: MovementReportQuery): Prisma.StockMovementItemWhereInput {
  const period = resolvePeriod(query.from, query.to);
  const and: Prisma.StockMovementItemWhereInput[] = [
    {
      movement: {
        createdAt: { gte: period.from, lte: period.to },
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.userId ? { OR: [{ createdById: query.userId }, { checkedById: query.userId }] } : {}),
      },
    },
  ];
  if (query.productId) and.push({ productId: query.productId });
  if (query.locationId) and.push({ OR: [{ fromLocationId: query.locationId }, { toLocationId: query.locationId }] });
  if (query.sectorId) and.push({ OR: [{ fromLocation: { sectorId: query.sectorId } }, { toLocation: { sectorId: query.sectorId } }] });
  return { AND: and };
}

export async function fetchMovementReport(query: MovementReportQuery, all: boolean) {
  const prisma = getPrisma();
  const where = movementWhere(query);
  const total = await prisma.stockMovementItem.count({ where });
  if (all) assertExportable(total);
  const rows = await prisma.stockMovementItem.findMany({
    where,
    select: movementItemSelect,
    orderBy: [{ movement: { createdAt: 'desc' } }, { id: 'asc' }],
    ...(all ? {} : skipTake(query.page, query.pageSize)),
  });
  return toPage(rows.map(presentMovementRow), total, query.page, all ? Math.max(total, 1) : query.pageSize);
}

// ---------------------------------------------------------------------------
// Divergências
// ---------------------------------------------------------------------------

const discrepancySelect = {
  number: true,
  type: true,
  status: true,
  origin: true,
  createdAt: true,
  resolvedAt: true,
  expectedQuantity: true,
  foundQuantity: true,
  estimatedValue: true,
  probableCause: true,
  correctiveAction: true,
  product: { select: { internalCode: true, name: true } },
  location: { select: { code: true, sector: { select: { code: true, name: true } } } },
  reportedBy: { select: { name: true } },
  operationUser: { select: { name: true } },
  assignedTo: { select: { name: true } },
} satisfies Prisma.DiscrepancySelect;

type DiscrepancyRow = Prisma.DiscrepancyGetPayload<{ select: typeof discrepancySelect }>;

function presentDiscrepancyRow(row: DiscrepancyRow) {
  return {
    number: row.number,
    type: DISCREPANCY_TYPE_LABEL[row.type],
    status: DISCREPANCY_STATUS_LABEL[row.status],
    origin: DISCREPANCY_ORIGIN_LABEL[row.origin],
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    productCode: row.product?.internalCode ?? null,
    productName: row.product?.name ?? null,
    location: row.location?.code ?? null,
    sector: row.location?.sector.name ?? null,
    expectedQuantity: toNumber(row.expectedQuantity),
    foundQuantity: toNumber(row.foundQuantity),
    estimatedValue: toNumber(row.estimatedValue),
    probableCause: PROBABLE_CAUSE_LABEL[row.probableCause],
    reportedBy: row.reportedBy.name,
    operationUser: row.operationUser?.name ?? null,
    assignedTo: row.assignedTo?.name ?? null,
    correctiveAction: row.correctiveAction,
  };
}

export type DiscrepancyReportRow = ReturnType<typeof presentDiscrepancyRow>;

export const discrepancyReport: ReportDefinition<DiscrepancyReportRow> = {
  key: 'divergencias',
  title: 'Divergências de estoque',
  columns: [
    { header: 'Nº', value: (r) => r.number },
    { header: 'Tipo', value: (r) => r.type },
    { header: 'Status', value: (r) => r.status },
    { header: 'Origem', value: (r) => r.origin },
    { header: 'Registrada em', value: (r) => dateTime(r.createdAt) },
    { header: 'Resolvida em', value: (r) => dateTime(r.resolvedAt) },
    { header: 'Código do produto', value: (r) => r.productCode },
    { header: 'Produto', value: (r) => r.productName },
    { header: 'Endereço', value: (r) => r.location },
    { header: 'Setor', value: (r) => r.sector },
    { header: 'Qtd. esperada', value: (r) => r.expectedQuantity },
    { header: 'Qtd. encontrada', value: (r) => r.foundQuantity },
    { header: 'Valor estimado (R$)', value: (r) => r.estimatedValue },
    { header: 'Causa provável', value: (r) => r.probableCause },
    { header: 'Registrada por', value: (r) => r.reportedBy },
    // Contexto para análise de processo — não indica responsabilidade pelo erro.
    { header: 'Executante da operação (contexto)', value: (r) => r.operationUser },
    { header: 'Responsável pela análise', value: (r) => r.assignedTo },
    { header: 'Ação corretiva', value: (r) => r.correctiveAction },
  ],
};

function discrepancyWhere(query: DiscrepancyReportQuery): Prisma.DiscrepancyWhereInput {
  const period = resolvePeriod(query.from, query.to);
  return {
    createdAt: { gte: period.from, lte: period.to },
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.operationUserId ? { operationUserId: query.operationUserId } : {}),
    ...(query.sectorId || query.warehouseId
      ? { location: { ...(query.sectorId ? { sectorId: query.sectorId } : {}), ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) } }
      : {}),
  };
}

export async function fetchDiscrepancyReport(query: DiscrepancyReportQuery, all: boolean) {
  const prisma = getPrisma();
  const where = discrepancyWhere(query);
  const total = await prisma.discrepancy.count({ where });
  if (all) assertExportable(total);
  const rows = await prisma.discrepancy.findMany({
    where,
    select: discrepancySelect,
    orderBy: { createdAt: 'desc' },
    ...(all ? {} : skipTake(query.page, query.pageSize)),
  });
  return toPage(rows.map(presentDiscrepancyRow), total, query.page, all ? Math.max(total, 1) : query.pageSize);
}

// ---------------------------------------------------------------------------
// Estoque atual
// ---------------------------------------------------------------------------

const balanceSelect = {
  quantity: true,
  updatedAt: true,
  product: { select: { id: true, internalCode: true, name: true, unit: true, minStock: true, category: { select: { name: true } } } },
  location: { select: { code: true, sector: { select: { name: true } } } },
  lot: { select: { code: true, expiresAt: true } },
} satisfies Prisma.StockBalanceSelect;

type BalanceRow = Prisma.StockBalanceGetPayload<{ select: typeof balanceSelect }>;

function presentBalanceRow(row: BalanceRow, totals: Map<string, Prisma.Decimal>) {
  const total = totals.get(row.product.id) ?? new Prisma.Decimal(0);
  return {
    productCode: row.product.internalCode,
    productName: row.product.name,
    category: row.product.category?.name ?? null,
    location: row.location.code,
    sector: row.location.sector.name,
    lot: row.lot?.code ?? null,
    expiresAt: row.lot?.expiresAt ?? null,
    quantity: toNumber(row.quantity),
    unit: row.product.unit,
    productTotal: toNumber(total),
    minStock: toNumber(row.product.minStock),
    belowMinimum: row.product.minStock.gt(0) && total.lt(row.product.minStock),
    updatedAt: row.updatedAt,
  };
}

export type StockReportRow = ReturnType<typeof presentBalanceRow>;

export const stockReport: ReportDefinition<StockReportRow> = {
  key: 'estoque-atual',
  title: 'Estoque atual por endereço',
  columns: [
    { header: 'Código do produto', value: (r) => r.productCode },
    { header: 'Produto', value: (r) => r.productName },
    { header: 'Categoria', value: (r) => r.category },
    { header: 'Endereço', value: (r) => r.location },
    { header: 'Setor', value: (r) => r.sector },
    { header: 'Lote', value: (r) => r.lot },
    { header: 'Validade', value: (r) => (r.expiresAt ? r.expiresAt.toISOString().slice(0, 10) : null) },
    { header: 'Quantidade no endereço', value: (r) => r.quantity },
    { header: 'Unidade', value: (r) => r.unit },
    { header: 'Saldo total do produto', value: (r) => r.productTotal },
    { header: 'Estoque mínimo', value: (r) => r.minStock },
    { header: 'Abaixo do mínimo', value: (r) => (r.belowMinimum ? 'Sim' : 'Não') },
    { header: 'Atualizado em', value: (r) => dateTime(r.updatedAt) },
  ],
};

export async function fetchStockReport(query: StockReportQuery, all: boolean) {
  const prisma = getPrisma();
  const where: Prisma.StockBalanceWhereInput = {
    quantity: { gt: 0 },
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.sectorId || query.warehouseId
      ? { location: { ...(query.sectorId ? { sectorId: query.sectorId } : {}), ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) } }
      : {}),
  };
  if (query.belowMinimum === 'true') {
    const ids = await productIdsBelowMinimum(prisma);
    where.productId = query.productId ? (ids.includes(query.productId) ? query.productId : '00000000-0000-0000-0000-000000000000') : { in: ids };
  }

  const total = await prisma.stockBalance.count({ where });
  if (all) assertExportable(total);
  const rows = await prisma.stockBalance.findMany({
    where,
    select: balanceSelect,
    orderBy: [{ product: { name: 'asc' } }, { location: { code: 'asc' } }],
    ...(all ? {} : skipTake(query.page, query.pageSize)),
  });
  const totals = await stockTotalsByProduct(prisma, [...new Set(rows.map((row) => row.product.id))]);
  return toPage(rows.map((row) => presentBalanceRow(row, totals)), total, query.page, all ? Math.max(total, 1) : query.pageSize);
}
