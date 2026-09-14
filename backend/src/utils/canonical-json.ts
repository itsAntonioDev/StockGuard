/**
 * JSON com chaves ordenadas — a mesma entrada sempre gera a mesma string.
 * Necessário para que o hash encadeado da auditoria seja reprodutível.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (source[key] !== undefined) acc[key] = normalize(source[key]);
        return acc;
      }, {});
  }
  return value;
}
