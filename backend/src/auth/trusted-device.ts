import type { CookieSerializeOptions } from '@fastify/cookie';
import { createHmac } from 'node:crypto';
import { getEnv, type Env } from '../config/env.js';
import { safeEqual, sha256Hex } from './crypto.js';

/**
 * "Lembrar este dispositivo": dispensa o código MFA neste navegador por alguns dias.
 *
 * O cookie é apenas um comprovante assinado (HMAC) — não guarda segredo nem sessão,
 * e a senha continua obrigatória em todo login. A assinatura inclui uma impressão
 * digital da conta: trocar/redefinir a senha ou redefinir o MFA invalida na hora
 * todos os dispositivos lembrados, sem precisar de tabela nova.
 */
const VERSION = 'v1';

export interface DeviceBinding {
  userId: string;
  passwordChangedAt: Date;
  mfaSecretEnc: string | null;
}

/** Impressão digital da conta: muda quando a senha ou a semente do MFA mudam. */
function bindingHash(binding: DeviceBinding): string {
  return sha256Hex(`${binding.userId}.${binding.passwordChangedAt.getTime()}.${binding.mfaSecretEnc ?? ''}`).slice(0, 32);
}

/** Chave derivada da chave de MFA, com rótulo próprio (nunca reutiliza a chave direto). */
function sign(payload: string, env: Env): string {
  return createHmac('sha256', Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64')).update(`trusted-device.${payload}`).digest('base64url');
}

export function trustedDeviceCookieName(env: Env = getEnv()): string {
  return env.COOKIE_SECURE ? '__Host-sg_trusted' : 'sg_trusted';
}

export function trustedDeviceCookieOptions(expiresAt: Date, env: Env = getEnv()): CookieSerializeOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/', expires: expiresAt };
}

export interface TrustedDeviceToken {
  value: string;
  expiresAt: Date;
}

/** Emite o comprovante; null quando o recurso está desligado (MFA_REMEMBER_DAYS=0). */
export function issueTrustedDevice(binding: DeviceBinding, env: Env = getEnv()): TrustedDeviceToken | null {
  if (env.MFA_REMEMBER_DAYS <= 0) return null;
  const expiresAt = new Date(Date.now() + env.MFA_REMEMBER_DAYS * 86_400_000);
  const payload = Buffer.from(
    JSON.stringify({ u: binding.userId, b: bindingHash(binding), e: Math.floor(expiresAt.getTime() / 1000) }),
    'utf8',
  ).toString('base64url');
  return { value: `${VERSION}.${payload}.${sign(payload, env)}`, expiresAt };
}

/** Confere assinatura, validade e vínculo com a conta — qualquer divergência recusa. */
export function isTrustedDevice(token: string | undefined, binding: DeviceBinding, env: Env = getEnv()): boolean {
  if (!token || env.MFA_REMEMBER_DAYS <= 0 || token.length > 512) return false;
  const [version, payload, signature] = token.split('.');
  if (version !== VERSION || !payload || !signature) return false;
  if (!safeEqual(signature, sign(payload, env))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; b?: unknown; e?: unknown };
    if (typeof data.u !== 'string' || typeof data.b !== 'string' || typeof data.e !== 'number') return false;
    if (data.e * 1000 <= Date.now()) return false;
    return data.u === binding.userId && safeEqual(data.b, bindingHash(binding));
  } catch {
    return false;
  }
}
