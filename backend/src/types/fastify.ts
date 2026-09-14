import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PermissionCode, RoleCode } from '../auth/permissions.js';
import type { AuthStep } from '../lib/errors.js';

/** Instância do Fastify com validação/serialização via Zod. */
export type App = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, FastifyBaseLogger, ZodTypeProvider>;

/** Usuário autenticado, resolvido a partir da sessão a cada requisição. */
export interface Actor {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  roleCode: RoleCode | string;
  sectorId: string | null;
  permissions: ReadonlySet<PermissionCode>;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }

  interface FastifyContextConfig {
    /** Rota acessível sem sessão. Todas as outras exigem autenticação. */
    public?: boolean;
    /**
     * Permissões aceitas (basta uma). Obrigatório em toda rota não pública —
     * use [] para rotas que exigem apenas estar autenticado.
     */
    permissions?: PermissionCode[];
    /** Etapas de segurança pendentes que ainda permitem acessar a rota. */
    allowSteps?: AuthStep[];
  }
}
