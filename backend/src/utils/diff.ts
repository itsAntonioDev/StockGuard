/**
 * Diferença campo a campo para auditoria (antes → depois).
 * Compara por valor serializado para tratar Decimal e Date corretamente.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const next = after[key];
    if (next === undefined) continue;
    const previous = before[key];
    if (serialize(previous) !== serialize(next)) {
      changes[key] = { from: serialize(previous), to: serialize(next) };
    }
  }
  return changes;
}

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function' && !Array.isArray(value)) {
    const text = value.toString();
    if (text !== '[object Object]') return text;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}
