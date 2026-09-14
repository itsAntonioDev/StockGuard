import * as controller from '../controllers/movement.controller.js';
import type { App } from '../types/fastify.js';
import { idempotencyHeaderSchema, idParamSchema } from '../validators/common.js';
import {
  checkConfirmSchema,
  checkScanSchema,
  movementCreateSchema,
  movementListQuerySchema,
  reasonBodySchema,
} from '../validators/movement.schemas.js';

export async function movementRoutes(app: App) {
  const tags = ['Movimentações'];
  const read = { permissions: ['movements.read.own' as const, 'movements.read.all' as const, 'checks.perform' as const] };

  app.get('/movements', { config: read, schema: { tags, querystring: movementListQuerySchema } }, controller.listMovements);

  app.get('/movements/:id', { config: read, schema: { tags, params: idParamSchema } }, controller.getMovement);

  // A permissão específica por tipo (movimentar x solicitar ajuste) é verificada no serviço.
  app.post('/movements', {
    config: { permissions: ['movements.create', 'movements.adjust.request'] },
    schema: { tags, headers: idempotencyHeaderSchema, body: movementCreateSchema },
  }, controller.createMovement);

  app.post('/movements/:id/cancel', {
    config: { permissions: ['movements.create', 'movements.adjust.request', 'movements.cancel'] },
    schema: { tags, params: idParamSchema, body: reasonBodySchema },
  }, controller.cancelMovement);

  app.post('/movements/:id/approve', {
    config: { permissions: ['movements.adjust.approve'] },
    schema: { tags, params: idParamSchema },
  }, controller.approveAdjustment);

  app.post('/movements/:id/reject', {
    config: { permissions: ['movements.adjust.approve'] },
    schema: { tags, params: idParamSchema, body: reasonBodySchema },
  }, controller.rejectAdjustment);

  const checkTags = ['Conferência'];

  app.post('/movements/:id/check', {
    config: { permissions: ['checks.perform'] },
    schema: { tags: checkTags, params: idParamSchema, body: checkScanSchema },
  }, controller.checkItem);

  app.post('/movements/:id/confirm', {
    config: { permissions: ['checks.perform'] },
    schema: { tags: checkTags, params: idParamSchema, body: checkConfirmSchema },
  }, controller.confirmWithCheck);
}
