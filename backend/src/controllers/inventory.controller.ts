import type { FastifyReply, FastifyRequest } from 'fastify';
import * as inventoryService from '../services/inventory.service.js';
import { getActor, requestContext } from '../utils/request-context.js';
import type {
  InventoryCountInput,
  InventoryCreateInput,
  InventoryItemsQuery,
  InventoryListQuery,
} from '../validators/inventory.schemas.js';
import type { ReasonBody } from '../validators/movement.schemas.js';

type IdParams = { Params: { id: string } };

export const listInventories = (request: FastifyRequest<{ Querystring: InventoryListQuery }>) => inventoryService.listInventories(request.query);

export const getInventory = (request: FastifyRequest<IdParams>) => inventoryService.getInventory(getActor(request), request.params.id);

export const listItems = (request: FastifyRequest<IdParams & { Querystring: InventoryItemsQuery }>) =>
  inventoryService.listInventoryItems(getActor(request), request.params.id, request.query);

export async function openInventory(request: FastifyRequest<{ Body: InventoryCreateInput }>, reply: FastifyReply) {
  const inventory = await inventoryService.openInventory(getActor(request), request.body, requestContext(request));
  return reply.status(201).send(inventory);
}

export const registerCount = (request: FastifyRequest<IdParams & { Body: InventoryCountInput }>) =>
  inventoryService.registerCount(getActor(request), request.params.id, request.body, requestContext(request));

export const submit = (request: FastifyRequest<IdParams>) =>
  inventoryService.submitInventory(getActor(request), request.params.id, requestContext(request));

export const approve = (request: FastifyRequest<IdParams>) =>
  inventoryService.approveInventory(getActor(request), request.params.id, requestContext(request), request.log);

export const cancel = (request: FastifyRequest<IdParams & { Body: ReasonBody }>) =>
  inventoryService.cancelInventory(getActor(request), request.params.id, request.body.reason, requestContext(request));
