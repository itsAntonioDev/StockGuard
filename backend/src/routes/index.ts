import { getEnv } from '../config/env.js';
import { getPrisma } from '../lib/prisma.js';
import type { App } from '../types/fastify.js';
import { adminRoutes } from './admin.routes.js';
import { alertRoutes } from './alert.routes.js';
import { discrepancyRoutes } from './discrepancy.routes.js';
import { authRoutes } from './auth.routes.js';
import { catalogRoutes } from './catalog.routes.js';
import { locationRoutes } from './location.routes.js';
import { movementRoutes } from './movement.routes.js';

export interface RoutesOptions {
  loginRateLimitMax: number;
}

/** Registra todas as rotas da API sob /api/v1. */
export async function registerRoutes(app: App, options: RoutesOptions) {
  app.get('/health', { config: { public: true }, schema: { hide: true } }, async (_request, reply) => {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      // Não expõe o motivo da falha (credenciais, host do banco etc.).
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  if (getEnv().NODE_ENV !== 'production') {
    app.get('/openapi.json', { config: { public: true }, schema: { hide: true } }, async () => app.swagger());
  }

  await authRoutes(app, options);
  await adminRoutes(app);
  await catalogRoutes(app);
  await locationRoutes(app);
  await movementRoutes(app);
  await discrepancyRoutes(app);
  await alertRoutes(app);
}
