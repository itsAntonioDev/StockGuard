import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senhas com Argon2id nos parâmetros mínimos recomendados pela OWASP
 * (m=19 MiB, t=2, p=1). O valor 2 corresponde a Algorithm.Argon2id — o enum da
 * biblioteca é `const enum` ambiente e não pode ser importado com isolatedModules.
 */
const ARGON2ID = 2;
const HASH_OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Hash usado quando o e-mail não existe, para que a resposta leve o mesmo tempo
 * e não revele quais contas estão cadastradas.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('stockguard-timing-equalizer-not-a-real-password');
  return dummyHash;
}

const COMMON_PASSWORDS = new Set([
  '123456789012', 'senha1234567', 'password1234', 'qwertyuiop12', 'administrador',
  'estoque12345', 'stockguard123', 'mudar@123456', 'admin@123456', '1q2w3e4r5t6y',
]);

export interface PasswordContext {
  email?: string | null;
  name?: string | null;
}

/** Retorna a lista de problemas encontrados (vazia = senha aceita). */
export function validatePasswordPolicy(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`Use no máximo ${PASSWORD_MAX_LENGTH} caracteres.`);

  const classes = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((regex) => regex.test(password)).length;
  if (classes < 3) problems.push('Combine pelo menos 3 destes: minúsculas, maiúsculas, números e símbolos.');

  if (/(.)\1{3,}/u.test(password)) problems.push('Evite repetir o mesmo caractere 4 ou mais vezes seguidas.');

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) problems.push('Esta senha é muito comum.');

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    problems.push('A senha não pode conter seu e-mail.');
  }
  const firstName = context.name?.trim().split(/\s+/u)[0]?.toLowerCase();
  if (firstName && firstName.length >= 4 && lower.includes(firstName)) {
    problems.push('A senha não pode conter seu nome.');
  }
  return problems;
}
