import * as controller from '../controllers/analytics.controller.js';
import type { App } from '../types/fastify.js';
import {
  dashboardQuerySchema,
  discrepancyReportQuerySchema,
  movementReportQuerySchema,
  productivityQuerySchema,
  reportSummaryQuerySchema,
  stockReportQuerySchema,
} from '../validators/analytics.schemas.js';

export async function analyticsRoutes(app: App) {
  app.get('/analytics/dashboard', {
    config: { permissions: ['dashboard.read'] },
    schema: { tags: ['Indicadores'], querystring: dashboardQuerySchema },
  }, controller.dashboard);

  app.get('/analytics/productivity', {
    config: { permissions: ['productivity.read.all', 'productivity.read.own'] },
    schema: { tags: ['Indicadores'], querystring: productivityQuerySchema },
  }, controller.productivity);

  const tags = ['Relatórios'];
  app.get('/reports/summary', { config: { permissions: ['reports.read'] }, schema: { tags, querystring: reportSummaryQuerySchema } }, controller.reportSummary);
  app.get('/reports/movements', { config: { permissions: ['reports.read'] }, schema: { tags, querystring: movementReportQuerySchema } }, controller.movements);
  app.get('/reports/discrepancies', { config: { permissions: ['reports.read'] }, schema: { tags, querystring: discrepancyReportQuerySchema } }, controller.discrepancies);
  app.get('/reports/stock', { config: { permissions: ['reports.read'] }, schema: { tags, querystring: stockReportQuerySchema } }, controller.stock);
}
