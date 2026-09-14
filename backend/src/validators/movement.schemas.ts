import { z } from 'zod';
import { nonNegativeQuantitySchema, positiveQuantitySchema } from '../utils/quantity.js';
import { codeSchema, optionalText, paginationSchema, requiredText } from './common.js';

export const movementTypeSchema = z.enum(['ENTRY', 'EXIT', 'PICKING', 'TRANSFER', 'ADJUSTMENT', 'INVENTORY']);
/** INVENTORY só é gerado pela aprovação de inventário, nunca criado diretamente. */
export const creatableMovementTypeSchema = z.enum(['ENTRY', 'EXIT', 'PICKING', 'TRANSFER', 'ADJUSTMENT']);
export const movementStatusSchema = z.enum(['PENDING_CHECK', 'PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED', 'REJECTED']);

const movementItemSchema = z
  .object({
    productId: z.uuid(),
    lotId: z.uuid().optional(),
    /** Novo lote informado no recebimento (entrada ou ajuste de entrada). */
    lotCode: codeSchema(60).transform((value) => value.toUpperCase()).optional(),
    lotExpiresAt: z.coerce.date().optional(),
    fromLocationId: z.uuid().optional(),
    toLocationId: z.uuid().optional(),
    quantity: positiveQuantitySchema,
    direction: z.enum(['IN', 'OUT']).optional(),
  })
  .refine((item) => !(item.lotId && item.lotCode), { message: 'Informe lotId ou lotCode, não ambos.', path: ['lotCode'] });

export const movementCreateSchema = z
  .object({
    type: creatableMovementTypeSchema,
    warehouseId: z.uuid(),
    referenceDoc: optionalText(60),
    reason: optionalText(500),
    notes: optionalText(1000),
    items: z.array(movementItemSchema).min(1, 'Informe ao menos um item.').max(200, 'No máximo 200 itens por movimentação.'),
  })
  .superRefine((movement, ctx) => {
    movement.items.forEach((item, index) => {
      const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['items', index, field], message });
      const incoming = movement.type === 'ENTRY' || (movement.type === 'ADJUSTMENT' && item.direction === 'IN');

      switch (movement.type) {
        case 'ENTRY':
          if (!item.toLocationId) issue('toLocationId', 'Entrada exige endereço de destino.');
          if (item.fromLocationId) issue('fromLocationId', 'Entrada não possui endereço de origem.');
          break;
        case 'EXIT':
        case 'PICKING':
          if (!item.fromLocationId) issue('fromLocationId', 'Saída/separação exige endereço de origem.');
          if (item.toLocationId) issue('toLocationId', 'Saída/separação não possui endereço de destino.');
          break;
        case 'TRANSFER':
          if (!item.fromLocationId) issue('fromLocationId', 'Transferência exige endereço de origem.');
          if (!item.toLocationId) issue('toLocationId', 'Transferência exige endereço de destino.');
          if (item.fromLocationId && item.fromLocationId === item.toLocationId) issue('toLocationId', 'Origem e destino devem ser diferentes.');
          break;
        case 'ADJUSTMENT':
          if (!item.direction) issue('direction', 'Ajuste exige direção: IN (acréscimo) ou OUT (baixa).');
          if (item.direction === 'IN' && (!item.toLocationId || item.fromLocationId)) issue('toLocationId', 'Ajuste de acréscimo exige apenas o endereço de destino.');
          if (item.direction === 'OUT' && (!item.fromLocationId || item.toLocationId)) issue('fromLocationId', 'Ajuste de baixa exige apenas o endereço de origem.');
          break;
      }
      if (movement.type !== 'ADJUSTMENT' && item.direction) issue('direction', 'Direção só se aplica a ajustes.');
      if ((item.lotCode || item.lotExpiresAt) && !incoming) issue('lotCode', 'Novos lotes só podem ser informados em entradas.');
    });

    if (movement.type === 'ADJUSTMENT' && (!movement.reason || movement.reason.length < 10)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Ajustes exigem justificativa com pelo menos 10 caracteres.' });
    }
  });

export const movementListQuerySchema = paginationSchema.extend({
  type: movementTypeSchema.optional(),
  status: movementStatusSchema.optional(),
  warehouseId: z.uuid().optional(),
  productId: z.uuid().optional(),
  createdById: z.uuid().optional(),
  number: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const reasonBodySchema = z.object({
  reason: requiredText(5, 500),
});

/** Leitura do conferente para um item: tudo é informado, nada é pré-preenchido. */
export const checkScanSchema = z.object({
  itemId: z.uuid(),
  locationCode: z.string().trim().min(1, 'Leia o endereço.').max(40),
  destinationCode: z.string().trim().min(1).max(40).optional(),
  productCode: z.string().trim().min(1, 'Leia o produto.').max(64),
  lotCode: z.string().trim().min(1).max(60).optional(),
  quantity: nonNegativeQuantitySchema,
});

export const checkConfirmSchema = z.object({
  items: z.array(checkScanSchema).min(1).max(200),
  /** Obrigatória para confirmar com diferença de quantidade (somente gestores). */
  varianceReason: optionalText(500),
});

export type MovementCreateInput = z.infer<typeof movementCreateSchema>;
export type MovementItemInput = MovementCreateInput['items'][number];
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
export type ReasonBody = z.infer<typeof reasonBodySchema>;
export type CheckScanInput = z.infer<typeof checkScanSchema>;
export type CheckConfirmInput = z.infer<typeof checkConfirmSchema>;
