import { z } from 'zod';
import { nonNegativeQuantitySchema } from '../utils/quantity.js';
import { optionalText, paginationSchema, requiredText } from './common.js';

export const discrepancyTypeSchema = z.enum([
  'WRONG_PRODUCT',
  'QUANTITY_MISMATCH',
  'WRONG_LOCATION',
  'PRODUCT_NOT_FOUND',
  'NEGATIVE_STOCK',
  'DUPLICATE_PRODUCT',
  'WRONG_LOT',
  'WRONG_UNIT',
]);
export const discrepancyStatusSchema = z.enum(['OPEN', 'IN_ANALYSIS', 'CORRECTED', 'CONFIRMED', 'DISCARDED']);
export const discrepancyOriginSchema = z.enum(['CHECK', 'INVENTORY', 'MANUAL']);
export const probableCauseSchema = z.enum([
  'NOT_DETERMINED',
  'PROCESS',
  'TRAINING',
  'LABELING',
  'SYSTEM_DATA',
  'SUPPLIER',
  'PHYSICAL_LAYOUT',
  'DAMAGE',
  'LOSS',
  'OTHER',
]);

const shortCode = z.string().trim().min(1).max(64).optional();

export const discrepancyCreateSchema = z
  .object({
    type: discrepancyTypeSchema,
    productId: z.uuid().optional(),
    lotId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    /** Item da movimentação onde a divergência foi encontrada (liga operação e contexto). */
    movementItemId: z.uuid().optional(),
    expectedQuantity: nonNegativeQuantitySchema.optional(),
    foundQuantity: nonNegativeQuantitySchema.optional(),
    expectedCode: shortCode,
    foundCode: shortCode,
    description: requiredText(10, 2000),
  })
  .refine((value) => value.productId || value.locationId || value.movementItemId, {
    message: 'Informe o produto, o endereço ou o item da movimentação.',
    path: ['productId'],
  })
  .refine((value) => value.type !== 'QUANTITY_MISMATCH' || (value.expectedQuantity !== undefined && value.foundQuantity !== undefined), {
    message: 'Divergência de quantidade exige a quantidade esperada e a encontrada.',
    path: ['foundQuantity'],
  });

export const discrepancyListQuerySchema = paginationSchema.extend({
  status: discrepancyStatusSchema.optional(),
  type: discrepancyTypeSchema.optional(),
  origin: discrepancyOriginSchema.optional(),
  productId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  sectorId: z.uuid().optional(),
  operationUserId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const discrepancyStatusChangeSchema = z.object({
  status: z.enum(['IN_ANALYSIS', 'CORRECTED', 'CONFIRMED', 'DISCARDED']),
  note: optionalText(2000),
  correctiveAction: optionalText(2000),
  probableCause: probableCauseSchema.optional(),
});

export const discrepancyAssignSchema = z.object({
  assignedToId: z.uuid().nullable(),
});

export const discrepancyCommentSchema = z.object({
  note: requiredText(2, 2000),
});

export const evidenceParamsSchema = z.object({
  id: z.uuid(),
  evidenceId: z.uuid(),
});

export type DiscrepancyCreateInput = z.infer<typeof discrepancyCreateSchema>;
export type DiscrepancyListQuery = z.infer<typeof discrepancyListQuerySchema>;
export type DiscrepancyStatusChangeInput = z.infer<typeof discrepancyStatusChangeSchema>;
export type DiscrepancyAssignInput = z.infer<typeof discrepancyAssignSchema>;
export type DiscrepancyCommentInput = z.infer<typeof discrepancyCommentSchema>;
