import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';
import { Prisma } from '../lib/prisma.js';

/**
 * Formato único de erro: { error: { code, message, details?, requestId } }.
 * Stack traces e mensagens internas vão apenas para o log do servidor.
 */
function send(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string, details?: unknown) {
  return reply.status(status).send({
    error: { code, message, ...(details === undefined ? {} : { details }), requestId: request.id },
  });
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((issue) => ({
      field: issue.instancePath.replace(/^\//u, '').replaceAll('/', '.') || null,
      message: issue.message,
    }));
    return send(reply, request, 400, 'VALIDATION_ERROR', 'Dados inválidos. Verifique os campos informados.', details);
  }

  if (isResponseSerializationError(error)) {
    request.log.error({ err: error }, 'Resposta fora do contrato');
    return send(reply, request, 500, 'INTERNAL_ERROR', 'Erro interno. Informe o código da requisição ao suporte.');
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
    return send(reply, request, error.statusCode, error.code, error.message, error.details);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return send(reply, request, 409, 'DUPLICATE', 'Já existe um registro com estes dados únicos.');
    }
    if (error.code === 'P2025') {
      return send(reply, request, 404, 'NOT_FOUND', 'Registro não encontrado.');
    }
    if (error.code === 'P2003') {
      return send(reply, request, 422, 'INVALID_REFERENCE', 'Referência a um registro inexistente.');
    }
  }

  if (error.statusCode === 429) {
    return send(reply, request, 429, 'TOO_MANY_REQUESTS', 'Muitas requisições. Aguarde e tente novamente.');
  }

  // Erros do próprio Fastify (JSON malformado, corpo grande demais, content-type inválido...).
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return send(reply, request, error.statusCode, error.code ?? 'BAD_REQUEST', 'Requisição inválida.');
  }

  request.log.error({ err: error }, 'Erro não tratado');
  return send(reply, request, 500, 'INTERNAL_ERROR', 'Erro interno. Informe o código da requisição ao suporte.');
}
