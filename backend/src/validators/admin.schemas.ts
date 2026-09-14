import { z } from 'zod';
import { PERMISSION_CODES, type PermissionCode } from '../auth/permissions.js';
import { paginationSchema, requiredText, searchSchema } from './common.js';

export const userListQuerySchema = paginationSchema.extend({
  search: searchSchema,
  roleId: z.uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
});

export const userCreateSchema = z.object({
  name: requiredText(3, 120),
  email: z.email('E-mail inválido.').max(254).transform((value) => value.toLowerCase()),
  roleId: z.uuid(),
  sectorId: z.uuid().optional(),
  trainingStartedAt: z.coerce.date().optional(),
});

export const userUpdateSchema = z
  .object({
    name: requiredText(3, 120).optional(),
    roleId: z.uuid().optional(),
    sectorId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
    trainingStartedAt: z.coerce.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Informe ao menos um campo.' });

export const rolePermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSION_CODES as [PermissionCode, ...PermissionCode[]])).max(PERMISSION_CODES.length),
});

export const settingKeyParamSchema = z.object({ key: z.string().trim().min(1).max(80) });

export const settingUpdateSchema = z.object({ value: z.unknown() });

export const auditListQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actorId: z.uuid().optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(64).optional(),
  result: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type RolePermissionsInput = z.infer<typeof rolePermissionsSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
