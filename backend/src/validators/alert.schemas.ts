import { z } from 'zod';
import { paginationSchema } from './common.js';

export const alertListQuerySchema = paginationSchema.extend({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  type: z
    .enum(['LOW_STOCK', 'NEGATIVE_STOCK_ATTEMPT', 'WRONG_LOCATION', 'QUANTITY_MISMATCH', 'RECURRING_DISCREPANCY', 'PENDING_OPERATION', 'REPEATED_INVALID_ATTEMPTS'])
    .optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
});

export type AlertListQuery = z.infer<typeof alertListQuerySchema>;
