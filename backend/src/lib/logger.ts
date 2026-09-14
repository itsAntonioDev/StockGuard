import type { FastifyServerOptions } from 'fastify';
import type { Env } from '../config/env.js';

/**
 * Logs estruturados (JSON) com remoção de dados sensíveis. Os serializadores
 * padrão do Fastify não registram corpo nem cabeçalhos; o redact é uma segunda barreira.
 */
export function buildLoggerOptions(env: Env): FastifyServerOptions['logger'] {
  if (env.LOG_LEVEL === 'silent') return false;
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.code',
      ],
      censor: '[REDACTED]',
    },
  };
}
