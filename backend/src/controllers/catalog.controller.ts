import type { FastifyReply, FastifyRequest } from 'fastify';
import * as catalogService from '../services/catalog.service.js';
import { requestContext } from '../utils/request-context.js';
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  HistoryQuery,
  LotCreateInput,
  ProductCreateInput,
  ProductListQuery,
  ProductUpdateInput,
} from '../validators/catalog.schemas.js';

type IdParams = { Params: { id: string } };

export async function listProducts(request: FastifyRequest<{ Querystring: ProductListQuery }>) {
  return catalogService.listProducts(request.query);
}

export async function getProduct(request: FastifyRequest<IdParams>) {
  return catalogService.getProduct(request.params.id);
}

export async function lookupProduct(request: FastifyRequest<{ Querystring: { code: string } }>) {
  return catalogService.lookupProduct(request.query.code);
}

export async function createProduct(request: FastifyRequest<{ Body: ProductCreateInput }>, reply: FastifyReply) {
  const product = await catalogService.createProduct(request.body, requestContext(request));
  return reply.status(201).send(product);
}

export async function updateProduct(request: FastifyRequest<IdParams & { Body: ProductUpdateInput }>) {
  return catalogService.updateProduct(request.params.id, request.body, requestContext(request));
}

export async function productHistory(request: FastifyRequest<IdParams & { Querystring: HistoryQuery }>) {
  return catalogService.listProductHistory(request.params.id, request.query);
}

export async function listLots(request: FastifyRequest<IdParams>) {
  return { items: await catalogService.listLots(request.params.id) };
}

export async function createLot(request: FastifyRequest<IdParams & { Body: LotCreateInput }>, reply: FastifyReply) {
  const lot = await catalogService.createLot(request.params.id, request.body, requestContext(request));
  return reply.status(201).send(lot);
}

export async function listCategories(request: FastifyRequest<{ Querystring: { includeInactive?: 'true' | 'false' } }>) {
  return { items: await catalogService.listCategories(request.query.includeInactive === 'true') };
}

export async function createCategory(request: FastifyRequest<{ Body: CategoryCreateInput }>, reply: FastifyReply) {
  const category = await catalogService.createCategory(request.body, requestContext(request));
  return reply.status(201).send(category);
}

export async function updateCategory(request: FastifyRequest<IdParams & { Body: CategoryUpdateInput }>) {
  return catalogService.updateCategory(request.params.id, request.body, requestContext(request));
}

export async function deleteProduct(request: FastifyRequest<IdParams>, reply: FastifyReply) {
  await catalogService.deleteProduct(request.params.id, requestContext(request));
  return reply.status(204).send();
}

export async function deleteLot(request: FastifyRequest<IdParams>, reply: FastifyReply) {
  await catalogService.deleteLot(request.params.id, requestContext(request));
  return reply.status(204).send();
}
