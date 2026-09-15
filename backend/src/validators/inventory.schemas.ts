import { z } from 'zod';
import { nonNegativeQuantitySchema } from '../utils/quantity.js';
import { optionalText, paginationSchema } from './common.js';

export const inventoryStatusSchema = z.enum(['OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED']);

export const inventoryCreateSchema = z.object({
  warehouseId: z.uuid(),
  /** Sem setor = inventário do armazém inteiro. */
  sectorId: z.uuid().optional(),
  /** Contagem cega: quem conta não vê a quantidade do sistema. */
  blind: z.boolean().default(true),
  notes: optionalText(1000),
});

export const inventoryListQuerySchema = paginationSchema.extend({
  status: inventoryStatusSchema.optional(),
  warehouseId: z.uuid().optional(),
});

export const inventoryItemsQuerySchema = paginationSchema.extend({
  onlyPending: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(60).optional(),
});

/** Registro de contagem: tudo o que foi lido fisicamente, nada pré-preenchido. */
export const inventoryCountSchema = z.object({
  locationCode: z.string().trim().min(1, 'Leia o endereço.').max(40),
  productCode: z.string().trim().min(1, 'Leia o produto.').max(64),
  lotCode: z.string().trim().min(1).max(60).optional(),
  lotExpiresAt: z.coerce.date().optional(),
  quantity: nonNegativeQuantitySchema,
});

export type InventoryCreateInput = z.infer<typeof inventoryCreateSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type InventoryItemsQuery = z.infer<typeof inventoryItemsQuerySchema>;
export type InventoryCountInput = z.infer<typeof inventoryCountSchema>;
