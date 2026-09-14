import type { FastifyRequest } from 'fastify';
import { AuthenticationError } from '../lib/errors.js';
import type { Actor } from '../types/fastify.js';

/** Dados da requisição usados em auditoria. */
export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string | null;
  actorId: string | null;
}

export function requestContext(request: FastifyRequest): RequestContext {
  return {
    requestId: request.id,
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    actorId: request.actor?.userId ?? null,
  };
}

/** Usuário autenticado da requisição (as rotas protegidas sempre o possuem). */
export function getActor(request: FastifyRequest): Actor {
  if (!request.actor) throw new AuthenticationError();
  return request.actor;
}
