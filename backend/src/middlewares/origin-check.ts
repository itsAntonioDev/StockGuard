import type { FastifyInstance } from 'fastify';
import { getEnv } from '../config/env.js';
import { ForbiddenError } from '../lib/errors.js';
import { writeAuditSafe } from '../services/audit.service.js';
import { requestContext } from '../utils/request-context.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção contra CSRF em camadas:
 * 1. Cookie de sessão SameSite=Strict (navegador não o envia em requisições cross-site);
 * 2. Esta verificação: métodos que alteram dados só são aceitos com Origin igual
 *    ao frontend autorizado (ou, sem Origin, com Sec-Fetch-Site: same-origin).
 */
export function registerOriginCheck(app: FastifyInstance): void {
  const allowedOrigin = getEnv().FRONTEND_ORIGIN;

  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin === allowedOrigin) return;
    if (origin === undefined && request.headers['sec-fetch-site'] === 'same-origin') return;

    await writeAuditSafe(
      requestContext(request),
      {
        action: 'security.origin_rejected',
        result: 'DENIED',
        metadata: { method: request.method, url: request.url.slice(0, 200), origin: origin?.slice(0, 200) ?? null },
      },
      request.log,
    );
    throw new ForbiddenError('Origem da requisição não autorizada.');
  });
}
