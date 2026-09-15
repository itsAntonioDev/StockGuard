import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '../lib/errors.js';
import { writeAuditSafe } from '../services/audit.service.js';
import { getDashboard, getReportSummary } from '../services/dashboard.service.js';
import { getProductivity } from '../services/productivity.service.js';
import {
  discrepancyReport,
  fetchDiscrepancyReport,
  fetchMovementReport,
  fetchProductivityReport,
  fetchStockReport,
  movementReport,
  productivityReport,
  stockReport,
  type ReportDefinition,
} from '../services/report.service.js';
import { getTimezone } from '../services/settings.service.js';
import { toCsv } from '../utils/csv.js';
import { getActor, requestContext } from '../utils/request-context.js';
import type {
  DashboardQuery,
  DiscrepancyReportQuery,
  MovementReportQuery,
  ProductivityQuery,
  ProductivityReportQuery,
  ReportSummaryQuery,
  StockReportQuery,
} from '../validators/analytics.schemas.js';

export const dashboard = (request: FastifyRequest<{ Querystring: DashboardQuery }>) => getDashboard(request.query);

export const productivityIndicators = (request: FastifyRequest<{ Querystring: ProductivityQuery }>) => getProductivity(getActor(request), request.query);

export const reportSummary = (request: FastifyRequest<{ Querystring: ReportSummaryQuery }>) => getReportSummary(request.query);

/**
 * JSON paginado para a tela; CSV completo para download. Exportações exigem
 * permissão própria e ficam auditadas (monitoramento de extração de dados).
 */
async function respond<Row, Query extends { format: 'json' | 'csv' }>(
  request: FastifyRequest,
  reply: FastifyReply,
  query: Query,
  definition: ReportDefinition<Row>,
  fetch: (query: Query, all: boolean) => Promise<{ items: Row[]; total: number }>,
) {
  if (query.format === 'json') return fetch(query, false);

  const actor = getActor(request);
  if (!actor.permissions.has('reports.export')) {
    await writeAuditSafe(requestContext(request), { action: 'reports.export', result: 'DENIED', metadata: { report: definition.key } }, request.log);
    throw new ForbiddenError('Você não tem permissão para exportar relatórios.');
  }

  const page = await fetch(query, true);
  const { format: _format, ...filters } = query as Query & Record<string, unknown>;
  await writeAuditSafe(
    requestContext(request),
    { action: 'reports.export', result: 'SUCCESS', entityType: 'Report', entityId: definition.key, metadata: { filters, rows: page.total } },
    request.log,
  );

  const fileName = `${definition.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${fileName}"`)
    .header('cache-control', 'private, no-store')
    .send(toCsv(definition.columns, page.items));
}

export const movements = async (request: FastifyRequest<{ Querystring: MovementReportQuery }>, reply: FastifyReply) =>
  respond(request, reply, request.query, movementReport(await getTimezone()), fetchMovementReport);

export const discrepancies = async (request: FastifyRequest<{ Querystring: DiscrepancyReportQuery }>, reply: FastifyReply) =>
  respond(request, reply, request.query, discrepancyReport(await getTimezone()), fetchDiscrepancyReport);

export const stock = async (request: FastifyRequest<{ Querystring: StockReportQuery }>, reply: FastifyReply) =>
  respond(request, reply, request.query, stockReport(await getTimezone()), fetchStockReport);

export const productivity = (request: FastifyRequest<{ Querystring: ProductivityReportQuery }>, reply: FastifyReply) =>
  respond(request, reply, request.query, productivityReport, (query) => fetchProductivityReport(getActor(request), query));
