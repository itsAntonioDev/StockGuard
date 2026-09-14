/**
 * Remove campos sensíveis de objetos antes de registrá-los (auditoria/logs).
 * Regra: nunca registrar senhas, tokens, segredos, hashes ou códigos MFA.
 */
const SENSITIVE_KEY = /^code$|pass(word)?|secret|token|hash|cookie|authorization|totp|credential|api_?key/iu;
const MAX_DEPTH = 6;
const MAX_STRING = 500;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactSensitive(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(inner, depth + 1);
  }
  return output;
}
