import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Env } from '../config/env.js';
import { getEnv } from '../config/env.js';
import { randomToken, sha256Hex } from '../auth/crypto.js';
import type { PermissionCode } from '../auth/permissions.js';
import type { AuthStep } from '../lib/errors.js';
import { getPrisma, type DbClient } from '../lib/prisma.js';
import type { RequestContext } from '../utils/request-context.js';

/**
 * Sessões opacas guardadas no banco (apenas o hash do token).
 * Vantagem sobre JWT: logout, bloqueio e troca de senha têm efeito imediato.
 */
const TOUCH_INTERVAL_MS = 60_000;

export function sessionCookieName(env: Env = getEnv()): string {
  // O prefixo __Host- exige Secure + Path=/ + sem Domain (impede sobrescrita por subdomínios).
  return env.COOKIE_SECURE ? '__Host-sg_session' : 'sg_session';
}

export function sessionCookieOptions(expiresAt: Date, env: Env = getEnv()): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  };
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  sectorId: string | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  role: { id: string; code: string; name: string };
  permissions: PermissionCode[];
}

export interface ResolvedSession {
  sessionId: string;
  mfaVerified: boolean;
  expiresAt: Date;
  user: SessionUser;
}

export async function createSession(
  db: DbClient,
  userId: string,
  context: RequestContext,
  mfaVerified: boolean,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const env = getEnv();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  const session = await db.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      mfaVerified,
      ip: context.ip,
      userAgent: context.userAgent,
      expiresAt,
    },
    select: { id: true },
  });
  return { token, sessionId: session.id, expiresAt };
}

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  if (token.length < 20 || token.length > 100) return null;
  const env = getEnv();
  const prisma = getPrisma();

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: { select: { code: true } } } } } },
        },
      },
    },
  });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > env.SESSION_IDLE_MINUTES * 60_000) {
    await revokeSession(prisma, session.id, 'IDLE_TIMEOUT');
    return null;
  }
  if (!session.user.active) {
    await revokeSession(prisma, session.id, 'USER_INACTIVE');
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }

  const { user } = session;
  return {
    sessionId: session.id,
    mfaVerified: session.mfaVerified,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      sectorId: user.sectorId,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: user.mfaEnabled,
      role: { id: user.role.id, code: user.role.code, name: user.role.name },
      permissions: user.role.permissions.map((link) => link.permission.code as PermissionCode),
    },
  };
}

/** Próxima etapa de segurança exigida antes de liberar o sistema. */
export function pendingAuthStep(
  user: Pick<SessionUser, 'mfaEnabled' | 'mustChangePassword' | 'role'>,
  mfaVerified: boolean,
  env: Env = getEnv(),
): AuthStep | null {
  const mfaRequired = env.MFA_REQUIRED_ROLES.includes(user.role.code);
  if (mfaRequired && !user.mfaEnabled) return 'MFA_SETUP';
  if (user.mfaEnabled && !mfaVerified) return 'MFA_VERIFY';
  if (user.mustChangePassword) return 'CHANGE_PASSWORD';
  return null;
}

export async function revokeSession(db: DbClient, sessionId: string, reason: string): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeUserSessions(db: DbClient, userId: string, reason: string, exceptSessionId?: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}
