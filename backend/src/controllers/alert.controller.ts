import type { FastifyRequest } from 'fastify';
import * as alertService from '../services/alert.service.js';
import { toPage } from '../validators/common.js';
import { getActor, requestContext } from '../utils/request-context.js';
import type { AlertListQuery } from '../validators/alert.schemas.js';

type IdParams = { Params: { id: string } };

export async function listAlerts(request: FastifyRequest<{ Querystring: AlertListQuery }>) {
  const { total, items } = await alertService.listAlerts(request.query);
  return toPage(items, total, request.query.page, request.query.pageSize);
}

export async function summary() {
  return { open: await alertService.countOpenAlerts() };
}

export async function acknowledge(request: FastifyRequest<IdParams>) {
  return alertService.changeAlertStatus(request.params.id, 'ACKNOWLEDGED', getActor(request).userId, requestContext(request));
}

export async function resolve(request: FastifyRequest<IdParams>) {
  return alertService.changeAlertStatus(request.params.id, 'RESOLVED', getActor(request).userId, requestContext(request));
}
