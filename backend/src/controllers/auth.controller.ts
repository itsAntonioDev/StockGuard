import type { FastifyReply, FastifyRequest } from 'fastify';
import { trustedDeviceCookieName, trustedDeviceCookieOptions, type TrustedDeviceToken } from '../auth/trusted-device.js';
import { AuthenticationError } from '../lib/errors.js';
import * as authService from '../services/auth.service.js';
import {
  pendingAuthStep,
  sessionCookieName,
  sessionCookieOptions,
  type ResolvedSession,
} from '../services/session.service.js';
import { requestContext } from '../utils/request-context.js';
import type { ChangePasswordBody, LoginBody, MfaCodeBody } from '../validators/auth.schemas.js';

function currentSession(request: FastifyRequest): ResolvedSession {
  if (!request.session) throw new AuthenticationError();
  return request.session;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(sessionCookieName(), token, sessionCookieOptions(expiresAt));
}

function clearSessionCookie(reply: FastifyReply) {
  const { expires: _ignored, ...options } = sessionCookieOptions(new Date(0));
  reply.clearCookie(sessionCookieName(), options);
}

/** Comprovante de "lembrar este dispositivo": só dispensa o código MFA, nunca a senha. */
function setTrustedDeviceCookie(reply: FastifyReply, trustedDevice: TrustedDeviceToken | null) {
  if (trustedDevice) reply.setCookie(trustedDeviceCookieName(), trustedDevice.value, trustedDeviceCookieOptions(trustedDevice.expiresAt));
}

function clearTrustedDeviceCookie(reply: FastifyReply) {
  const { expires: _ignored, ...options } = trustedDeviceCookieOptions(new Date(0));
  reply.clearCookie(trustedDeviceCookieName(), options);
}

export async function login(request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) {
  const result = await authService.login(
    request.body.email,
    request.body.password,
    requestContext(request),
    request.cookies[trustedDeviceCookieName()],
  );
  setSessionCookie(reply, result.token, result.expiresAt);
  return { pendingStep: result.pendingStep, expiresAt: result.expiresAt };
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  await authService.logout(currentSession(request), requestContext(request));
  clearSessionCookie(reply);
  return reply.status(204).send();
}

export async function me(request: FastifyRequest) {
  const session = currentSession(request);
  const pendingStep = pendingAuthStep(session.user, session.mfaVerified);
  const { user } = session;
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      sectorId: user.sectorId,
      mfaEnabled: user.mfaEnabled,
      role: user.role,
    },
    // Enquanto houver etapa pendente, nenhuma permissão é exposta ao cliente.
    permissions: pendingStep ? [] : [...user.permissions].sort(),
    pendingStep,
    sessionExpiresAt: session.expiresAt,
  };
}

export async function startMfaSetup(request: FastifyRequest) {
  return authService.startMfaSetup(currentSession(request).user.id, requestContext(request));
}

export async function confirmMfaSetup(request: FastifyRequest<{ Body: MfaCodeBody }>, reply: FastifyReply) {
  const grant = await authService.confirmMfaSetup(currentSession(request), request.body.code, requestContext(request), request.body.rememberDevice);
  setSessionCookie(reply, grant.token, grant.expiresAt);
  setTrustedDeviceCookie(reply, grant.trustedDevice);
  return { ok: true };
}

export async function verifyMfa(request: FastifyRequest<{ Body: MfaCodeBody }>, reply: FastifyReply) {
  const grant = await authService.verifyMfa(currentSession(request), request.body.code, requestContext(request), request.body.rememberDevice);
  setSessionCookie(reply, grant.token, grant.expiresAt);
  setTrustedDeviceCookie(reply, grant.trustedDevice);
  return { ok: true };
}

/** "Esquecer este dispositivo": passa a exigir o código MFA neste navegador de novo. */
export async function forgetTrustedDevice(request: FastifyRequest, reply: FastifyReply) {
  clearTrustedDeviceCookie(reply);
  return reply.status(204).send();
}

export async function changePassword(request: FastifyRequest<{ Body: ChangePasswordBody }>, reply: FastifyReply) {
  const grant = await authService.changePassword(
    currentSession(request),
    request.body.currentPassword,
    request.body.newPassword,
    requestContext(request),
  );
  setSessionCookie(reply, grant.token, grant.expiresAt);
  // A troca de senha invalida os dispositivos lembrados; o cookie antigo sai do navegador.
  clearTrustedDeviceCookie(reply);
  return { ok: true };
}

export async function listSessions(request: FastifyRequest) {
  const session = currentSession(request);
  return { items: await authService.listOwnSessions(session.user.id, session.sessionId) };
}

export async function revokeSession(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await authService.revokeOwnSession(currentSession(request).user.id, request.params.id, requestContext(request));
  return reply.status(204).send();
}
