import type { FastifyReply, FastifyRequest } from 'fastify';
import * as checkService from '../services/check.service.js';
import * as movementService from '../services/movement.service.js';
import { getActor, requestContext } from '../utils/request-context.js';
import type {
  CheckConfirmInput,
  CheckScanInput,
  MovementCreateInput,
  MovementListQuery,
  ReasonBody,
} from '../validators/movement.schemas.js';

type IdParams = { Params: { id: string } };

export async function listMovements(request: FastifyRequest<{ Querystring: MovementListQuery }>) {
  return movementService.listMovements(getActor(request), request.query);
}

export async function getMovement(request: FastifyRequest<IdParams>) {
  return movementService.getMovement(getActor(request), request.params.id);
}

export async function createMovement(
  request: FastifyRequest<{ Body: MovementCreateInput; Headers: { 'idempotency-key': string } }>,
  reply: FastifyReply,
) {
  const result = await movementService.createMovement(
    getActor(request),
    request.body,
    request.headers['idempotency-key'],
    requestContext(request),
    request.log,
  );
  // 200 na repetição idempotente (nada novo foi criado); 201 na criação.
  return reply.status(result.replayed ? 200 : 201).send(result);
}

export async function cancelMovement(request: FastifyRequest<IdParams & { Body: ReasonBody }>) {
  return movementService.cancelMovement(getActor(request), request.params.id, request.body.reason, requestContext(request));
}

export async function approveAdjustment(request: FastifyRequest<IdParams>) {
  return movementService.approveAdjustment(getActor(request), request.params.id, requestContext(request), request.log);
}

export async function rejectAdjustment(request: FastifyRequest<IdParams & { Body: ReasonBody }>) {
  return movementService.rejectAdjustment(getActor(request), request.params.id, request.body.reason, requestContext(request));
}

export async function checkItem(request: FastifyRequest<IdParams & { Body: CheckScanInput }>) {
  return checkService.checkItem(getActor(request), request.params.id, request.body, request.log);
}

export async function confirmWithCheck(request: FastifyRequest<IdParams & { Body: CheckConfirmInput }>) {
  return checkService.confirmWithCheck(getActor(request), request.params.id, request.body, requestContext(request), request.log);
}
