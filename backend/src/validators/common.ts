import { z } from 'zod';

export const idParamSchema = z.object({ id: z.uuid('Identificador inválido.') });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Período [from, to]. Datas ISO; limite de 366 dias para proteger o banco. */
export const periodSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'A data inicial deve ser anterior à final.',
    path: ['from'],
  })
  .refine((value) => !value.from || !value.to || value.to.getTime() - value.from.getTime() <= 366 * 86_400_000, {
    message: 'O período máximo é de 366 dias.',
    path: ['to'],
  });

/** Texto opcional: vazio vira undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const requiredText = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Código alfanumérico (produtos, endereços, lotes, documentos). */
export const codeSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9._/-]+$/u, 'Use apenas letras, números e . _ / -');

export const searchSchema = z.string().trim().max(100).optional();

/** Chave de idempotência obrigatória em operações críticas (cabeçalho Idempotency-Key). */
// looseObject: preserva os demais cabeçalhos (User-Agent etc.) usados pela auditoria.
export const idempotencyHeaderSchema = z.looseObject({
  'idempotency-key': z
    .string()
    .trim()
    .min(16, 'Idempotency-Key deve ter entre 16 e 100 caracteres.')
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/u, 'Idempotency-Key inválida.'),
});

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function skipTake(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
