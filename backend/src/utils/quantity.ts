import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import type { UnitOfMeasure } from '../generated/prisma/enums.js';

/**
 * Quantidades trafegam como string decimal (até 3 casas) para não perder
 * precisão com ponto flutuante; cálculos usam Prisma.Decimal.
 */
const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/u;

/** Unidades que admitem fração (peso, volume, comprimento). */
const FRACTIONAL_UNITS = new Set<UnitOfMeasure>(['KG', 'G', 'L', 'ML', 'M']);

export function unitAllowsFraction(unit: UnitOfMeasure): boolean {
  return FRACTIONAL_UNITS.has(unit);
}

function normalizeQuantity(value: string | number): string | null {
  const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
  return QUANTITY_PATTERN.test(text) ? text : null;
}

/** Quantidade estritamente positiva. */
export const positiveQuantitySchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const normalized = normalizeQuantity(value);
  if (normalized === null || new Prisma.Decimal(normalized).lte(0)) {
    ctx.addIssue({ code: 'custom', message: 'Quantidade deve ser maior que zero, com até 3 casas decimais.' });
    return z.NEVER;
  }
  return normalized;
});

/** Quantidade maior ou igual a zero (contagens de inventário, estoque mínimo). */
export const nonNegativeQuantitySchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const normalized = normalizeQuantity(value);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: 'Quantidade inválida (use até 3 casas decimais, sem sinal).' });
    return z.NEVER;
  }
  return normalized;
});

export function isQuantityCompatibleWithUnit(quantity: string | Prisma.Decimal, unit: UnitOfMeasure): boolean {
  if (unitAllowsFraction(unit)) return true;
  return new Prisma.Decimal(quantity).isInteger();
}

export function toNumber(value: Prisma.Decimal | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value.toString());
}

export function decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
