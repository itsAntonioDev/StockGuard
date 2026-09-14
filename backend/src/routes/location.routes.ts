import { z } from 'zod';
import * as controller from '../controllers/location.controller.js';
import type { App } from '../types/fastify.js';
import { idParamSchema } from '../validators/common.js';
import {
  locationBulkCreateSchema,
  locationCreateSchema,
  locationListQuerySchema,
  locationLookupQuerySchema,
  locationUpdateSchema,
  sectorCreateSchema,
  sectorUpdateSchema,
  warehouseCreateSchema,
  warehouseUpdateSchema,
} from '../validators/location.schemas.js';

export async function locationRoutes(app: App) {
  const tags = ['Endereços'];

  app.get('/warehouses', {
    config: { permissions: ['locations.read'] },
    schema: { tags },
  }, controller.listWarehouses);

  app.post('/warehouses', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, body: warehouseCreateSchema },
  }, controller.createWarehouse);

  app.patch('/warehouses/:id', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, params: idParamSchema, body: warehouseUpdateSchema },
  }, controller.updateWarehouse);

  app.get('/sectors', {
    config: { permissions: ['locations.read'] },
    schema: { tags, querystring: z.object({ warehouseId: z.uuid().optional() }) },
  }, controller.listSectors);

  app.post('/sectors', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, body: sectorCreateSchema },
  }, controller.createSector);

  app.patch('/sectors/:id', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, params: idParamSchema, body: sectorUpdateSchema },
  }, controller.updateSector);

  app.get('/locations', {
    config: { permissions: ['locations.read'] },
    schema: { tags, querystring: locationListQuerySchema },
  }, controller.listLocations);

  app.get('/locations/lookup', {
    config: { permissions: ['locations.read'] },
    schema: { tags, querystring: locationLookupQuerySchema },
  }, controller.lookupLocation);

  app.get('/locations/:id', {
    config: { permissions: ['locations.read'] },
    schema: { tags, params: idParamSchema },
  }, controller.getLocation);

  app.post('/locations', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, body: locationCreateSchema },
  }, controller.createLocation);

  app.post('/locations/bulk', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, body: locationBulkCreateSchema },
  }, controller.bulkCreateLocations);

  app.patch('/locations/:id', {
    config: { permissions: ['locations.manage'] },
    schema: { tags, params: idParamSchema, body: locationUpdateSchema },
  }, controller.updateLocation);
}
