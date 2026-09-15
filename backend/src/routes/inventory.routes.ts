import * as controller from '../controllers/inventory.controller.js';
import type { App } from '../types/fastify.js';
import { idParamSchema } from '../validators/common.js';
import {
  inventoryCountSchema,
  inventoryCreateSchema,
  inventoryItemsQuerySchema,
  inventoryListQuerySchema,
} from '../validators/inventory.schemas.js';
import { reasonBodySchema } from '../validators/movement.schemas.js';

export async function inventoryRoutes(app: App) {
  const tags = ['Inventário'];
  const read = { permissions: ['inventory.count' as const, 'inventory.manage' as const, 'inventory.approve' as const] };

  app.get('/inventories', { config: read, schema: { tags, querystring: inventoryListQuerySchema } }, controller.listInventories);
  app.post('/inventories', { config: { permissions: ['inventory.manage'] }, schema: { tags, body: inventoryCreateSchema } }, controller.openInventory);
  app.get('/inventories/:id', { config: read, schema: { tags, params: idParamSchema } }, controller.getInventory);
  app.get('/inventories/:id/items', { config: read, schema: { tags, params: idParamSchema, querystring: inventoryItemsQuerySchema } }, controller.listItems);
  app.post('/inventories/:id/counts', {
    config: { permissions: ['inventory.count'] },
    schema: { tags, params: idParamSchema, body: inventoryCountSchema },
  }, controller.registerCount);
  app.post('/inventories/:id/submit', { config: { permissions: ['inventory.manage'] }, schema: { tags, params: idParamSchema } }, controller.submit);
  app.post('/inventories/:id/approve', { config: { permissions: ['inventory.approve'] }, schema: { tags, params: idParamSchema } }, controller.approve);
  app.post('/inventories/:id/cancel', {
    config: { permissions: ['inventory.manage'] },
    schema: { tags, params: idParamSchema, body: reasonBodySchema },
  }, controller.cancel);
}
