export type DateFormat = 'DD/MM/AAAA' | 'AAAA-MM-DD';
export type TimeFormat = 'HH:mm' | 'hh:mm a';

interface DisplayConfig {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  timeZone?: string;
}

let display: DisplayConfig = { dateFormat: 'DD/MM/AAAA', timeFormat: 'HH:mm' };

/** Aplica as preferências de Configurações > Geral (chamado pelo AppShell). */
export function configureDisplay(next: Partial<DisplayConfig>): void {
  display = { ...display, ...next };
}

type DateInput = string | Date | null | undefined;

function parts(value: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('pt-BR', { ...(display.timeZone ? { timeZone: display.timeZone } : {}), ...options });
  return Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
}

function datePart(value: Date, utc = false): string {
  const p = parts(value, { day: '2-digit', month: '2-digit', year: 'numeric', ...(utc ? { timeZone: 'UTC' } : {}) });
  return display.dateFormat === 'AAAA-MM-DD' ? `${p.year}-${p.month}-${p.day}` : `${p.day}/${p.month}/${p.year}`;
}

function timePart(value: Date): string {
  const hour12 = display.timeFormat === 'hh:mm a';
  const p = parts(value, { hour: '2-digit', minute: '2-digit', hour12 });
  return hour12 ? `${p.hour}:${p.minute} ${p.dayPeriod ?? ''}`.trim() : `${p.hour}:${p.minute}`;
}

export function formatDateTime(value: DateInput): string {
  if (!value) return '—';
  const date = new Date(value);
  return `${datePart(date)} ${timePart(date)}`;
}

export function formatDate(value: DateInput): string {
  return value ? datePart(new Date(value)) : '—';
}

/** Datas sem hora (validade de lote) são gravadas em UTC: formatar em UTC evita "voltar um dia". */
export function formatDateOnly(value: DateInput): string {
  return value ? datePart(new Date(value), true) : '—';
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 3): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(value);
}

const currencyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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
  return display.dateFormat === 'AAAA-MM-DD' ? `${month}-${day}` : `${day}/${month}`;
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

/** "10 de abril de 2025" e "Quinta-feira" no fuso configurado. */
export function formatLongDate(value: Date): { date: string; weekday: string } {
  const zone = display.timeZone ? { timeZone: display.timeZone } : {};
  const date = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', ...zone }).format(value);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', ...zone }).format(value);
  return { date, weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1) };
}
