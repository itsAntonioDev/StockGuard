import { z } from 'zod';
import { nonNegativeQuantitySchema } from '../utils/quantity.js';
import { codeSchema, optionalText, paginationSchema, requiredText, searchSchema } from './common.js';

export const unitSchema = z.enum(['UN', 'CX', 'PCT', 'KG', 'G', 'L', 'ML', 'M']);
export const handlingClassSchema = z.enum(['STANDARD', 'FRAGILE', 'HEAVY', 'PERISHABLE', 'CONTROLLED']);

export const moneySchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
  // eslint-disable-next-line security/detect-unsafe-regex -- quantificadores limitados, sem repetição aninhada (sem risco de ReDoS)
  if (!/^\d{1,12}(\.\d{1,2})?$/u.test(text)) {
    ctx.addIssue({ code: 'custom', message: 'Valor monetário inválido (até 2 casas decimais).' });
    return z.NEVER;
  }
  return text;
});

const barcodeSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[0-9A-Za-z-]*$/u, 'Código de barras inválido.')
  .optional()
  .transform((value) => (value ? value : undefined));

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export const categoryCreateSchema = z.object({
  name: requiredText(2, 80),
  description: optionalText(300),
});

export const categoryUpdateSchema = z.object({
  name: requiredText(2, 80).optional(),
  description: optionalText(300),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

const productBase = z.object({
  barcode: barcodeSchema,
  name: requiredText(2, 160),
  description: optionalText(1000),
  categoryId: z.uuid().optional(),
  unit: unitSchema,
  minStock: nonNegativeQuantitySchema.default('0'),
  unitCost: moneySchema.optional(),
  tracksLot: z.boolean().default(false),
  tracksExpiry: z.boolean().default(false),
  handlingClass: handlingClassSchema.default('STANDARD'),
});

export const productCreateSchema = productBase
  .extend({ internalCode: codeSchema(40).transform((value) => value.toUpperCase()) })
  .refine((value) => !value.tracksExpiry || value.tracksLot, {
    message: 'Controle de validade exige controle de lote.',
    path: ['tracksExpiry'],
  });

/** O código interno não é editável: leituras e histórico dependem dele. */
export const productUpdateSchema = z
  .object({
    barcode: z.string().trim().max(64).regex(/^[0-9A-Za-z-]*$/u).nullable().optional(),
    name: requiredText(2, 160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    unit: unitSchema.optional(),
    minStock: nonNegativeQuantitySchema.optional(),
    unitCost: moneySchema.nullable().optional(),
    tracksLot: z.boolean().optional(),
    tracksExpiry: z.boolean().optional(),
    handlingClass: handlingClassSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos um campo.' });

export const productListQuerySchema = paginationSchema.extend({
  search: searchSchema,
  categoryId: z.uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
  belowMinimum: z.enum(['true', 'false']).optional(),
});

export const productLookupQuerySchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export const lotCreateSchema = z.object({
  code: codeSchema(60).transform((value) => value.toUpperCase()),
  expiresAt: z.coerce.date().optional(),
});

export const historyQuerySchema = paginationSchema.extend({
  locationId: z.uuid().optional(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type LotCreateInput = z.infer<typeof lotCreateSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
