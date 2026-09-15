import { z } from 'zod';

/**
 * Configuração validada na inicialização. A API não sobe com variáveis ausentes
 * ou inseguras — falhar cedo é melhor que operar mal configurada.
 */
const bool = (fallback: 'true' | 'false') =>
  z.enum(['true', 'false']).default(fallback).transform((value) => value === 'true');

const key32 = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, 'deve conter 32 bytes em base64');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    /** Schema das tabelas (public localmente; stockguard no Supabase, fora da API REST pública). */
    DATABASE_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{0,62}$/u, 'use apenas letras minúsculas, números e _')
      .default('public'),
    /** disable (local) | require (TLS sem verificar certificado) | verify (TLS com verificação). */
    DATABASE_SSL: z.enum(['disable', 'require', 'verify']).default('disable'),
    /** Certificado da autoridade do provedor (ex.: CA do Supabase) para DATABASE_SSL=verify. */
    DATABASE_CA_CERT_PATH: z.string().min(1).optional(),
    FRONTEND_ORIGIN: z.url(),
    /**
     * false | true | lista de IPs/CIDRs confiáveis (ex.: 127.0.0.1).
     * Atrás do proxy do Next.js use 127.0.0.1: o IP real vem do X-Forwarded-For
     * (necessário para rate limit por usuário), sem confiar em cabeçalhos de terceiros.
     */
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value): boolean | string[] => {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'false' || normalized === '') return false;
        if (normalized === 'true') return true;
        return normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
      }),
    COOKIE_SECURE: bool('true'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
    MFA_REQUIRED_ROLES: z
      .string()
      .default('ADMIN')
      .transform((value) =>
        value
          .split(',')
          .map((role) => role.trim().toUpperCase())
          .filter(Boolean),
      ),
    MFA_ENCRYPTION_KEY: key32,
    AUDIT_HMAC_KEY: key32,
    APP_TIMEZONE: z.string().min(1).default('America/Sao_Paulo'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    EVIDENCE_STORAGE_DIR: z.string().min(1).default('storage/evidence'),
    /** Requisições por minuto por IP (todas as rotas). */
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
    /** Tentativas de login por minuto por IP (complementa o bloqueio por conta). */
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'deve ser true em produção' });
      }
      if (env.DATABASE_SSL === 'require') {
        ctx.addIssue({ code: 'custom', path: ['DATABASE_SSL'], message: 'use verify (com certificado) em produção' });
      }
      if (!env.FRONTEND_ORIGIN.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: 'deve usar HTTPS em produção' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Lista apenas nomes e motivos — nunca os valores (podem conter segredos).
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuração inválida:\n- ${problems.join('\n- ')}`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
