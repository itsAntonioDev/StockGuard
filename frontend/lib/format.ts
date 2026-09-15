const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
// Datas sem hora (validade de lote) são gravadas em UTC: formatar em UTC evita "voltar um dia".
const dateOnlyFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const currencyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

type DateInput = string | Date | null | undefined;

export function formatDateTime(value: DateInput): string {
  return value ? dateTimeFormat.format(new Date(value)) : '—';
}

export function formatDate(value: DateInput): string {
  return value ? dateFormat.format(new Date(value)) : '—';
}

export function formatDateOnly(value: DateInput): string {
  return value ? dateOnlyFormat.format(new Date(value)) : '—';
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 3): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(value);
}

export function formatCurrency(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : currencyFormat.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`;
}

/** "2026-09-14" → "14/09" (rótulo de eixo em gráficos). */
export function formatBucket(bucket: string): string {
  const [, month, day] = bucket.split('-');
  return `${day}/${month}`;
}

export function formatElapsed(value: DateInput): string {
  if (!value) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} dias`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** ISO (yyyy-mm-dd) de N dias atrás, para filtros de período. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
