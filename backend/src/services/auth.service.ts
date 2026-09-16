import { getEnv } from '../config/env.js';
import { decryptSecret, encryptSecret, sha256Hex } from '../auth/crypto.js';
import { getDummyHash, hashPassword, validatePasswordPolicy, verifyPassword } from '../auth/password.js';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from '../auth/totp.js';
import { isTrustedDevice, issueTrustedDevice, type TrustedDeviceToken } from '../auth/trusted-device.js';
import { AuthenticationError, BusinessRuleError, ConflictError, ValidationError } from '../lib/errors.js';
import { getPrisma } from '../lib/prisma.js';
import type { RequestContext } from '../utils/request-context.js';
import { writeAudit, writeAuditSafe } from './audit.service.js';
import { createSession, pendingAuthStep, revokeSession, revokeUserSessions, type ResolvedSession } from './session.service.js';

const FAILED_ATTEMPTS_BEFORE_LOCK = 5;
const MAX_LOCK_MINUTES = 60;
const MAX_MFA_ATTEMPTS_PER_SESSION = 5;
const GENERIC_LOGIN_ERROR = 'E-mail ou senha inválidos, ou acesso temporariamente bloqueado.';

/** Bloqueio progressivo: 1, 2, 4, 8… minutos a partir da 5ª falha, até 60. */
export function computeLockMinutes(failedCount: number): number | null {
  if (failedCount < FAILED_ATTEMPTS_BEFORE_LOCK) return null;
  return Math.min(2 ** (failedCount - FAILED_ATTEMPTS_BEFORE_LOCK), MAX_LOCK_MINUTES);
}

export interface SessionGrant {
  token: string;
  expiresAt: Date;
}

export async function login(
  email: string,
  password: string,
  context: RequestContext,
  trustedDeviceToken?: string,
): Promise<SessionGrant & { pendingStep: string | null }> {
  const prisma = getPrisma();
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, include: { role: true } });

  if (!user) {
    await verifyPassword(await getDummyHash(), password);
    await writeAuditSafe(context, {
      action: 'auth.login',
      result: 'FAILURE',
      // Não grava o e-mail digitado (pode conter a senha por engano); só uma impressão digital.
      metadata: { reason: 'UNKNOWN_USER', emailFingerprint: sha256Hex(normalizedEmail).slice(0, 16) },
    });
    throw new AuthenticationError(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  const auditBase = { ...context, actorId: user.id };
  const now = new Date();
  const passwordOk = await verifyPassword(user.passwordHash, password);

  if (user.lockedUntil && user.lockedUntil > now) {
    await writeAuditSafe(auditBase, { action: 'auth.login', result: 'DENIED', entityType: 'User', entityId: user.id, metadata: { reason: 'LOCKED', lockedUntil: user.lockedUntil } });
    throw new AuthenticationError(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  if (!passwordOk) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lockMinutes = computeLockMinutes(updated.failedLoginCount);
    if (lockMinutes !== null) {
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(now.getTime() + lockMinutes * 60_000) } });
    }
    await writeAuditSafe(auditBase, {
      action: 'auth.login',
      result: 'FAILURE',
      entityType: 'User',
      entityId: user.id,
      metadata: { reason: 'WRONG_PASSWORD', failedCount: updated.failedLoginCount, lockMinutes },
    });
    throw new AuthenticationError(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  if (!user.active) {
    await writeAuditSafe(auditBase, { action: 'auth.login', result: 'DENIED', entityType: 'User', entityId: user.id, metadata: { reason: 'INACTIVE' } });
    throw new AuthenticationError(GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  // Dispositivo lembrado dispensa apenas o código MFA — a senha já foi exigida acima.
  const trustedDevice =
    user.mfaEnabled &&
    isTrustedDevice(trustedDeviceToken, { userId: user.id, passwordChangedAt: user.passwordChangedAt, mfaSecretEnc: user.mfaSecretEnc });

  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    const session = await createSession(tx, user.id, context, trustedDevice);
    const pendingStep = pendingAuthStep({ mfaEnabled: user.mfaEnabled, mustChangePassword: user.mustChangePassword, role: user.role }, trustedDevice);
    await writeAudit(tx, auditBase, { action: 'auth.login', result: 'SUCCESS', entityType: 'Session', entityId: session.sessionId, metadata: { pendingStep, trustedDevice } });
    return { token: session.token, expiresAt: session.expiresAt, pendingStep };
  });
}

export async function logout(session: ResolvedSession, context: RequestContext): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await revokeSession(tx, session.sessionId, 'LOGOUT');
    await writeAudit(tx, context, { action: 'auth.logout', result: 'SUCCESS', entityType: 'Session', entityId: session.sessionId });
  });
}

/** Inicia o cadastro do MFA: gera a semente e a guarda (cifrada) como pendente. */
export async function startMfaSetup(userId: string, context: RequestContext): Promise<{ secret: string; otpauthUri: string }> {
  const prisma = getPrisma();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, mfaEnabled: true } });
  if (user.mfaEnabled) throw new ConflictError('O MFA já está ativo para este usuário.', 'MFA_ALREADY_ENABLED');

  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaPendingSecretEnc: encryptSecret(secret, getEnv().MFA_ENCRYPTION_KEY) } });
  await writeAuditSafe(context, { action: 'auth.mfa.setup_started', result: 'SUCCESS', entityType: 'User', entityId: userId });
  return { secret, otpauthUri: buildOtpAuthUri(secret, user.email) };
}

async function registerMfaFailure(session: ResolvedSession, context: RequestContext, action: string): Promise<never> {
  const prisma = getPrisma();
  const updated = await prisma.session.update({
    where: { id: session.sessionId },
    data: { mfaFailedAttempts: { increment: 1 } },
    select: { mfaFailedAttempts: true },
  });
  const exhausted = updated.mfaFailedAttempts >= MAX_MFA_ATTEMPTS_PER_SESSION;
  if (exhausted) await revokeSession(prisma, session.sessionId, 'MFA_ATTEMPTS_EXCEEDED');
  await writeAuditSafe(context, { action, result: 'FAILURE', entityType: 'Session', entityId: session.sessionId, metadata: { attempts: updated.mfaFailedAttempts, sessionRevoked: exhausted } });
  if (exhausted) throw new AuthenticationError('Tentativas de código esgotadas. Faça login novamente.', 'MFA_ATTEMPTS_EXCEEDED');
  throw new ValidationError('Código inválido ou expirado.');
}

/** Confirma o cadastro do MFA e emite uma nova sessão já verificada. */
export async function confirmMfaSetup(
  session: ResolvedSession,
  code: string,
  context: RequestContext,
  rememberDevice = false,
): Promise<SessionGrant & { trustedDevice: TrustedDeviceToken | null }> {
  const prisma = getPrisma();
  const env = getEnv();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { mfaEnabled: true, mfaPendingSecretEnc: true, passwordChangedAt: true },
  });
  if (user.mfaEnabled) throw new ConflictError('O MFA já está ativo para este usuário.', 'MFA_ALREADY_ENABLED');
  if (!user.mfaPendingSecretEnc) throw new BusinessRuleError('MFA_SETUP_NOT_STARTED', 'Inicie a configuração do MFA antes de confirmar.');

  const secret = decryptSecret(user.mfaPendingSecretEnc, env.MFA_ENCRYPTION_KEY);
  const step = verifyTotp(secret, code);
  if (step === null) return registerMfaFailure(session, context, 'auth.mfa.setup_confirm');

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaLastUsedStep: step },
    });
    await revokeSession(tx, session.sessionId, 'ROTATED_MFA');
    const next = await createSession(tx, session.user.id, context, true);
    const trustedDevice = rememberDevice
      ? issueTrustedDevice({ userId: session.user.id, passwordChangedAt: user.passwordChangedAt, mfaSecretEnc: user.mfaPendingSecretEnc })
      : null;
    await writeAudit(tx, context, { action: 'auth.mfa.enabled', result: 'SUCCESS', entityType: 'User', entityId: session.user.id, metadata: { trustedDevice: trustedDevice !== null } });
    return { token: next.token, expiresAt: next.expiresAt, trustedDevice };
  });
}

/** Valida o código MFA do login e rotaciona a sessão (evita fixação de sessão). */
export async function verifyMfa(
  session: ResolvedSession,
  code: string,
  context: RequestContext,
  rememberDevice = false,
): Promise<SessionGrant & { trustedDevice: TrustedDeviceToken | null }> {
  const prisma = getPrisma();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { mfaEnabled: true, mfaSecretEnc: true, mfaLastUsedStep: true, passwordChangedAt: true },
  });
  if (!user.mfaEnabled || !user.mfaSecretEnc) throw new BusinessRuleError('MFA_NOT_ENABLED', 'O MFA não está ativo para este usuário.');
  if (session.mfaVerified) throw new ConflictError('Esta sessão já foi verificada.', 'MFA_ALREADY_VERIFIED');

  const step = verifyTotp(decryptSecret(user.mfaSecretEnc, getEnv().MFA_ENCRYPTION_KEY), code, { lastUsedStep: user.mfaLastUsedStep });
  if (step === null) return registerMfaFailure(session, context, 'auth.mfa.verify');

  return prisma.$transaction(async (tx) => {
    // Condição no WHERE impede que dois pedidos simultâneos usem o mesmo código.
    const claimed = await tx.user.updateMany({
      where: { id: session.user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
      data: { mfaLastUsedStep: step },
    });
    if (claimed.count === 0) throw new ValidationError('Código inválido ou expirado.');
    await revokeSession(tx, session.sessionId, 'ROTATED_MFA');
    const next = await createSession(tx, session.user.id, context, true);
    const trustedDevice = rememberDevice
      ? issueTrustedDevice({ userId: session.user.id, passwordChangedAt: user.passwordChangedAt, mfaSecretEnc: user.mfaSecretEnc })
      : null;
    await writeAudit(tx, context, { action: 'auth.mfa.verify', result: 'SUCCESS', entityType: 'Session', entityId: next.sessionId, metadata: { trustedDevice: trustedDevice !== null } });
    return { token: next.token, expiresAt: next.expiresAt, trustedDevice };
  });
}

export async function changePassword(
  session: ResolvedSession,
  currentPassword: string,
  newPassword: string,
  context: RequestContext,
): Promise<SessionGrant> {
  const prisma = getPrisma();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { passwordHash: true, email: true, name: true } });

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    await writeAuditSafe(context, { action: 'auth.password.change', result: 'FAILURE', entityType: 'User', entityId: session.user.id, metadata: { reason: 'WRONG_CURRENT_PASSWORD' } });
    throw new ValidationError('A senha atual está incorreta.');
  }
  const problems = validatePasswordPolicy(newPassword, { email: user.email, name: user.name });
  if (await verifyPassword(user.passwordHash, newPassword)) problems.push('A nova senha deve ser diferente da atual.');
  if (problems.length > 0) throw new ValidationError('A nova senha não atende à política de segurança.', { problems });

  const passwordHash = await hashPassword(newPassword);
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    const revoked = await revokeUserSessions(tx, session.user.id, 'PASSWORD_CHANGED');
    const next = await createSession(tx, session.user.id, context, session.mfaVerified);
    await writeAudit(tx, context, { action: 'auth.password.change', result: 'SUCCESS', entityType: 'User', entityId: session.user.id, metadata: { revokedSessions: revoked } });
    return { token: next.token, expiresAt: next.expiresAt };
  });
}

export async function listOwnSessions(userId: string, currentSessionId: string) {
  const sessions = await getPrisma().session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
  return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
}

export async function revokeOwnSession(userId: string, sessionId: string, context: RequestContext): Promise<void> {
  const prisma = getPrisma();
  // Filtra por userId: um usuário nunca encerra sessão de outro trocando o ID.
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' },
  });
  if (result.count === 0) throw new ValidationError('Sessão não encontrada.');
  await writeAuditSafe(context, { action: 'auth.session.revoke', result: 'SUCCESS', entityType: 'Session', entityId: sessionId });
}
