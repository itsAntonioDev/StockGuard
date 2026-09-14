import { z } from 'zod';
import * as controller from '../controllers/catalog.controller.js';
import type { App } from '../types/fastify.js';
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  historyQuerySchema,
  lotCreateSchema,
  productCreateSchema,
  productListQuerySchema,
  productLookupQuerySchema,
  productUpdateSchema,
} from '../validators/catalog.schemas.js';
import { idParamSchema } from '../validators/common.js';

export async function catalogRoutes(app: App) {
  const tags = ['Produtos'];

  app.get('/products', {
    config: { permissions: ['products.read'] },
    schema: { tags, querystring: productListQuerySchema },
  }, controller.listProducts);

  // Declarada antes de /products/:id para não ser capturada como ID.
  app.get('/products/lookup', {
    config: { permissions: ['products.read'] },
    schema: { tags, querystring: productLookupQuerySchema },
  }, controller.lookupProduct);

  app.get('/products/:id', {
    config: { permissions: ['products.read'] },
    schema: { tags, params: idParamSchema },
  }, controller.getProduct);

  app.post('/products', {
    config: { permissions: ['products.manage'] },
    schema: { tags, body: productCreateSchema },
  }, controller.createProduct);

  app.patch('/products/:id', {
    config: { permissions: ['products.manage'] },
    schema: { tags, params: idParamSchema, body: productUpdateSchema },
  }, controller.updateProduct);

  app.get('/products/:id/history', {
    config: { permissions: ['stock.read'] },
    schema: { tags, params: idParamSchema, querystring: historyQuerySchema },
  }, controller.productHistory);

  app.get('/products/:id/lots', {
    config: { permissions: ['products.read'] },
    schema: { tags, params: idParamSchema },
  }, controller.listLots);

  app.post('/products/:id/lots', {
    config: { permissions: ['products.manage'] },
    schema: { tags, params: idParamSchema, body: lotCreateSchema },
  }, controller.createLot);

  app.get('/categories', {
    config: { permissions: ['products.read'] },
    schema: { tags, querystring: z.object({ includeInactive: z.enum(['true', 'false']).optional() }) },
  }, controller.listCategories);

  app.post('/categories', {
    config: { permissions: ['products.manage'] },
    schema: { tags, body: categoryCreateSchema },
  }, controller.createCategory);

  app.patch('/categories/:id', {
    config: { permissions: ['products.manage'] },
    schema: { tags, params: idParamSchema, body: categoryUpdateSchema },
  }, controller.updateCategory);
}
