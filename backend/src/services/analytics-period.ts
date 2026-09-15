import { ValidationError } from '../lib/errors.js';
import { Prisma } from '../lib/prisma.js';

export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;

export interface Period {
  from: Date;
  to: Date;
}

/** Período padrão: últimos `defaultDays` dias até agora. Limite de 366 dias protege o banco. */
export function resolvePeriod(from: Date | undefined, to: Date | undefined, defaultDays = 30): Period {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - defaultDays * DAY_MS);
  if (start > end) throw new ValidationError('A data inicial deve ser anterior à final.');
  if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw new ValidationError(`O período máximo é de ${MAX_PERIOD_DAYS} dias.`);
  }
  return { from: start, to: end };
}

/** Período imediatamente anterior, de mesma duração (base de comparação). */
export function previousPeriod(period: Period): Period {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: new Date(period.from.getTime()) };
}

/**
 * Taxa de divergência (docs/metricas.md):
 *   operações conferidas com ≥1 divergência não descartada ÷ operações conferidas × 100
 * Retorna null sem base de cálculo — nunca 0% "inventado".
 */
export function discrepancyRate(withDiscrepancy: number, analyzed: number): number | null {
  if (analyzed <= 0) return null;
  return Math.round((withDiscrepancy / analyzed) * 10_000) / 100;
}

/** Variação percentual entre períodos; null quando não há base anterior. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

export const toInt = (value: bigint | number | null | undefined): number => (value == null ? 0 : Number(value));

export const toFloat = (value: Prisma.Decimal | number | string | null | undefined): number | null =>
  value == null ? null : Number(value.toString());
