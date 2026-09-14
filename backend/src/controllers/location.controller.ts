import type { FastifyReply, FastifyRequest } from 'fastify';
import * as locationService from '../services/location.service.js';
import { requestContext } from '../utils/request-context.js';
import type {
  LocationBulkCreateInput,
  LocationCreateInput,
  LocationListQuery,
  LocationLookupQuery,
  LocationUpdateInput,
  SectorCreateInput,
  SectorUpdateInput,
  WarehouseCreateInput,
  WarehouseUpdateInput,
} from '../validators/location.schemas.js';

type IdParams = { Params: { id: string } };

export async function listWarehouses() {
  return { items: await locationService.listWarehouses() };
}

export async function createWarehouse(request: FastifyRequest<{ Body: WarehouseCreateInput }>, reply: FastifyReply) {
  return reply.status(201).send(await locationService.createWarehouse(request.body, requestContext(request)));
}

export async function updateWarehouse(request: FastifyRequest<IdParams & { Body: WarehouseUpdateInput }>) {
  return locationService.updateWarehouse(request.params.id, request.body, requestContext(request));
}

export async function listSectors(request: FastifyRequest<{ Querystring: { warehouseId?: string } }>) {
  return { items: await locationService.listSectors(request.query.warehouseId) };
}

export async function createSector(request: FastifyRequest<{ Body: SectorCreateInput }>, reply: FastifyReply) {
  return reply.status(201).send(await locationService.createSector(request.body, requestContext(request)));
}

export async function updateSector(request: FastifyRequest<IdParams & { Body: SectorUpdateInput }>) {
  return locationService.updateSector(request.params.id, request.body, requestContext(request));
}

export async function listLocations(request: FastifyRequest<{ Querystring: LocationListQuery }>) {
  return locationService.listLocations(request.query);
}

export async function getLocation(request: FastifyRequest<IdParams>) {
  return locationService.getLocation(request.params.id);
}

export async function lookupLocation(request: FastifyRequest<{ Querystring: LocationLookupQuery }>) {
  return locationService.lookupLocation(request.query);
}

export async function createLocation(request: FastifyRequest<{ Body: LocationCreateInput }>, reply: FastifyReply) {
  return reply.status(201).send(await locationService.createLocation(request.body, requestContext(request)));
}

export async function bulkCreateLocations(request: FastifyRequest<{ Body: LocationBulkCreateInput }>, reply: FastifyReply) {
  return reply.status(201).send(await locationService.bulkCreateLocations(request.body, requestContext(request)));
}

export async function updateLocation(request: FastifyRequest<IdParams & { Body: LocationUpdateInput }>) {
  return locationService.updateLocation(request.params.id, request.body, requestContext(request));
}
