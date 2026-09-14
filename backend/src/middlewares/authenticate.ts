import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import type { PermissionCode } from '../auth/permissions.js';
import { AuthenticationError, AuthStepRequiredError, ForbiddenError } from '../lib/errors.js';
import { writeAuditSafe } from '../services/audit.service.js';
import { pendingAuthStep, resolveSession, sessionCookieName, type ResolvedSession } from '../services/session.service.js';
import { requestContext } from '../utils/request-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: ResolvedSession;
  }
}

/**
 * Seguro por padrão:
 * 1. Toda rota não pública PRECISA declarar `config.permissions` — senão a API nem sobe.
 * 2. Autenticação e autorização rodam antes da validação do corpo (quem não tem acesso
 *    não recebe detalhes do formato esperado).
 */
export function registerAuthGuards(app: FastifyInstance): void {
  app.addHook('onRoute', (route: RouteOptions) => {
    const config = (route.config ?? {}) as { public?: boolean; permissions?: PermissionCode[] };
    const isInternal = route.url.startsWith('/documentation');
    if (!isInternal && !config.public && !Array.isArray(config.permissions)) {
      throw new Error(`Rota ${String(route.method)} ${route.url} sem config.permissions (declare [] se exigir apenas autenticação).`);
    }
  });

  app.addHook('preValidation', async (request: FastifyRequest) => {
    const config = request.routeOptions.config;
    if (config.public) return;

    const token = request.cookies[sessionCookieName()];
    if (!token) throw new AuthenticationError();

    const session = await resolveSession(token);
    if (!session) throw new AuthenticationError('Sessão expirada ou inválida. Faça login novamente.', 'SESSION_EXPIRED');

    request.session = session;
    request.actor = {
      userId: session.user.id,
      sessionId: session.sessionId,
      name: session.user.name,
      email: session.user.email,
      roleCode: session.user.role.code,
      sectorId: session.user.sectorId,
      permissions: new Set(session.user.permissions),
    };

    const step = pendingAuthStep(session.user, session.mfaVerified);
    if (step && !(config.allowSteps ?? []).includes(step)) throw new AuthStepRequiredError(step);

    const required = config.permissions ?? [];
    if (required.length > 0 && !required.some((permission) => request.actor!.permissions.has(permission))) {
      await writeAuditSafe(
        requestContext(request),
        {
          action: 'authz.denied',
          result: 'DENIED',
          metadata: { method: request.method, route: request.routeOptions.url, required },
        },
        request.log,
      );
      throw new ForbiddenError();
    }
  });
}
