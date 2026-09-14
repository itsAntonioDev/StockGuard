import { z } from 'zod';
import { positiveQuantitySchema } from '../utils/quantity.js';
import { codeSchema, paginationSchema, requiredText, searchSchema } from './common.js';

/** Partes do endereço: letras e números, sem separadores (o hífen é inserido pelo servidor). */
const addressPart = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/u, `${label}: use apenas letras e números.`)
    .transform((value) => value.toUpperCase());

export const locationStatusSchema = z.enum(['ACTIVE', 'BLOCKED', 'INACTIVE']);

export const warehouseCreateSchema = z.object({
  code: codeSchema(20).transform((value) => value.toUpperCase()),
  name: requiredText(2, 120),
});

export const warehouseUpdateSchema = z
  .object({ name: requiredText(2, 120).optional(), active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos um campo.' });

export const sectorCreateSchema = z.object({
  warehouseId: z.uuid(),
  code: addressPart('Setor'),
  name: requiredText(2, 120),
});

export const sectorUpdateSchema = z
  .object({ name: requiredText(2, 120).optional(), active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos um campo.' });

export const locationCreateSchema = z.object({
  sectorId: z.uuid(),
  aisle: addressPart('Corredor'),
  shelf: addressPart('Prateleira'),
  position: addressPart('Posição'),
  capacity: positiveQuantitySchema.optional(),
});

/**
 * Criação em lote: gera a grade corredor × prateleira × posição de um setor
 * (numeração com 2 dígitos). Limitada a 1000 endereços por requisição.
 */
export const locationBulkCreateSchema = z
  .object({
    sectorId: z.uuid(),
    aisles: z.array(addressPart('Corredor')).min(1).max(50),
    shelfFrom: z.number().int().min(1).max(99),
    shelfTo: z.number().int().min(1).max(99),
    positionFrom: z.number().int().min(1).max(99),
    positionTo: z.number().int().min(1).max(99),
    capacity: positiveQuantitySchema.optional(),
  })
  .refine((value) => value.shelfFrom <= value.shelfTo, { message: 'Prateleira inicial deve ser menor ou igual à final.', path: ['shelfTo'] })
  .refine((value) => value.positionFrom <= value.positionTo, { message: 'Posição inicial deve ser menor ou igual à final.', path: ['positionTo'] })
  .refine(
    (value) => value.aisles.length * (value.shelfTo - value.shelfFrom + 1) * (value.positionTo - value.positionFrom + 1) <= 1000,
    { message: 'No máximo 1000 endereços por lote.', path: ['aisles'] },
  );

export const locationUpdateSchema = z
  .object({
    capacity: positiveQuantitySchema.nullable().optional(),
    status: locationStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos um campo.' });

export const locationListQuerySchema = paginationSchema.extend({
  warehouseId: z.uuid().optional(),
  sectorId: z.uuid().optional(),
  status: locationStatusSchema.optional(),
  search: searchSchema,
});

export const locationLookupQuerySchema = z.object({
  code: z.string().trim().min(1).max(40),
  warehouseId: z.uuid().optional(),
});

export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>;
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;
export type SectorCreateInput = z.infer<typeof sectorCreateSchema>;
export type SectorUpdateInput = z.infer<typeof sectorUpdateSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationBulkCreateInput = z.infer<typeof locationBulkCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type LocationListQuery = z.infer<typeof locationListQuerySchema>;
export type LocationLookupQuery = z.infer<typeof locationLookupQuerySchema>;
