import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto.js';

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) com HMAC-SHA1, 6 dígitos e passo de 30s —
 * o padrão aceito por Google Authenticator, Microsoft Authenticator, Authy etc.
 * Implementado sobre node:crypto para não depender de bibliotecas de terceiros.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Segredo base32 inválido.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Semente de 160 bits, conforme recomendado pela RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS);
}

export interface VerifyTotpOptions {
  nowMs?: number;
  /** Passos aceitos antes/depois do atual (tolerância de relógio). */
  window?: number;
  /** Último passo já utilizado — impede reutilização do mesmo código. */
  lastUsedStep?: number | null;
}

/** Retorna o passo validado ou null. */
export function verifyTotp(secretBase32: string, code: string, options: VerifyTotpOptions = {}): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(options.nowMs);
  const window = options.window ?? 1;
  for (let step = current - window; step <= current + window; step += 1) {
    if (options.lastUsedStep != null && step <= options.lastUsedStep) continue;
    if (safeEqual(hotp(secret, step), code)) return step;
  }
  return null;
}

export function buildOtpAuthUri(secretBase32: string, account: string, issuer = 'StockGuard'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
