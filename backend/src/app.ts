import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { getEnv } from './config/env.js';
import { buildLoggerOptions } from './lib/logger.js';
import { registerAuthGuards } from './middlewares/authenticate.js';
import { errorHandler } from './middlewares/error-handler.js';
import { registerOriginCheck } from './middlewares/origin-check.js';
import { registerRoutes } from './routes/index.js';
import { MAX_EVIDENCE_BYTES } from './services/evidence-storage.js';

export interface BuildAppOptions {
  rateLimitMax?: number;
  loginRateLimitMax?: number;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const env = getEnv();

  const base = Fastify({
    logger: buildLoggerOptions(env),
    // IDs gerados pelo servidor — cabeçalhos x-request-id do cliente são ignorados.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    return503OnClosing: true,
  });

  base.setValidatorCompiler(validatorCompiler);
  base.setSerializerCompiler(serializerCompiler);
  base.setErrorHandler(errorHandler);
  base.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.', requestId: request.id } }),
  );

  base.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // A API só responde JSON: CSP restritiva, sem embed em frames, sem cache.
  await base.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await base.register(cors, {
    origin: [env.FRONTEND_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['x-request-id', 'content-disposition'],
    maxAge: 600,
  });
  await base.register(cookie, { hook: 'onRequest' });
  await base.register(rateLimit, { global: true, max: options.rateLimitMax ?? env.RATE_LIMIT_MAX, timeWindow: '1 minute' });
  await base.register(multipart, { limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 5, parts: 6 } });
  if (env.NODE_ENV !== 'production') {
    await base.register(swagger, {
      openapi: { info: { title: 'StockGuard API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
  }

  registerOriginCheck(base);
  registerAuthGuards(base);

  const app = base.withTypeProvider<ZodTypeProvider>();
  await app.register(
    async (api) => {
      await registerRoutes(api.withTypeProvider<ZodTypeProvider>(), {
        loginRateLimitMax: options.loginRateLimitMax ?? env.LOGIN_RATE_LIMIT_MAX,
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
