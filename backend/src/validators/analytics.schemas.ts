import { z } from 'zod';
import { discrepancyStatusSchema, discrepancyTypeSchema } from './discrepancy.schemas.js';
import { paginationSchema } from './common.js';
import { movementStatusSchema, movementTypeSchema } from './movement.schemas.js';

const period = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

const scope = {
  warehouseId: z.uuid().optional(),
  sectorId: z.uuid().optional(),
};

const formatSchema = z.enum(['json', 'csv']).default('json');

export const dashboardQuerySchema = z.object({
  ...period,
  ...scope,
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

export const productivityQuerySchema = z.object({
  ...period,
  ...scope,
  /** Visão individual (apoio/treinamento). Sem permissão total, é sempre o próprio usuário. */
  userId: z.uuid().optional(),
});

export const reportSummaryQuerySchema = z.object({ ...period, ...scope });

export const movementReportQuerySchema = paginationSchema.extend({
  ...period,
  ...scope,
  format: formatSchema,
  type: movementTypeSchema.optional(),
  status: movementStatusSchema.optional(),
  productId: z.uuid().optional(),
  userId: z.uuid().optional(),
  locationId: z.uuid().optional(),
});

export const discrepancyReportQuerySchema = paginationSchema.extend({
  ...period,
  ...scope,
  format: formatSchema,
  type: discrepancyTypeSchema.optional(),
  status: discrepancyStatusSchema.optional(),
  productId: z.uuid().optional(),
  operationUserId: z.uuid().optional(),
  locationId: z.uuid().optional(),
});

export const stockReportQuerySchema = paginationSchema.extend({
  ...scope,
  format: formatSchema,
  productId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  belowMinimum: z.enum(['true', 'false']).optional(),
});

/** Produtividade agregada (por tipo de operação e setor) — nunca por pessoa. */
export const productivityReportQuerySchema = z.object({ ...period, ...scope, format: formatSchema });

export type ProductivityReportQuery = z.infer<typeof productivityReportQuerySchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type ProductivityQuery = z.infer<typeof productivityQuerySchema>;
export type ReportSummaryQuery = z.infer<typeof reportSummaryQuerySchema>;
export type MovementReportQuery = z.infer<typeof movementReportQuerySchema>;
export type DiscrepancyReportQuery = z.infer<typeof discrepancyReportQuerySchema>;
export type StockReportQuery = z.infer<typeof stockReportQuerySchema>;
