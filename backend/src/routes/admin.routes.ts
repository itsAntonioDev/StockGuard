import * as controller from '../controllers/admin.controller.js';
import type { App } from '../types/fastify.js';
import {
  auditListQuerySchema,
  rolePermissionsSchema,
  settingKeyParamSchema,
  settingUpdateSchema,
  userCreateSchema,
  userListQuerySchema,
  userUpdateSchema,
} from '../validators/admin.schemas.js';
import { idParamSchema } from '../validators/common.js';

export async function adminRoutes(app: App) {
  const manageUsers = { permissions: ['users.manage' as const, 'users.manage_operators' as const] };

  const userTags = ['Usuários'];
  app.get('/users', { config: { permissions: ['users.read'] }, schema: { tags: userTags, querystring: userListQuerySchema } }, controller.listUsers);
  app.get('/users/:id', { config: { permissions: ['users.read'] }, schema: { tags: userTags, params: idParamSchema } }, controller.getUser);
  app.post('/users', { config: manageUsers, schema: { tags: userTags, body: userCreateSchema } }, controller.createUser);
  app.patch('/users/:id', { config: manageUsers, schema: { tags: userTags, params: idParamSchema, body: userUpdateSchema } }, controller.updateUser);
  app.post('/users/:id/reset-password', { config: manageUsers, schema: { tags: userTags, params: idParamSchema } }, controller.resetPassword);
  app.post('/users/:id/unlock', { config: manageUsers, schema: { tags: userTags, params: idParamSchema } }, controller.unlockUser);
  app.post('/users/:id/reset-mfa', { config: { permissions: ['users.manage'] }, schema: { tags: userTags, params: idParamSchema } }, controller.resetMfa);

  const roleTags = ['Perfis e permissões'];
  app.get('/roles', { config: { permissions: ['users.read', 'roles.manage'] }, schema: { tags: roleTags } }, controller.listRoles);
  app.get('/permissions', { config: { permissions: ['roles.manage'] }, schema: { tags: roleTags } }, controller.listPermissions);
  app.put('/roles/:id/permissions', {
    config: { permissions: ['roles.manage'] },
    schema: { tags: roleTags, params: idParamSchema, body: rolePermissionsSchema },
  }, controller.updateRolePermissions);

  const settingTags = ['Configurações'];
  app.get('/settings', { config: { permissions: ['settings.manage'] }, schema: { tags: settingTags } }, controller.listSettings);
  // Preferências de exibição (nome da empresa, fuso, formatos): qualquer usuário autenticado.
  app.get('/settings/general', { config: { permissions: [] }, schema: { tags: settingTags } }, controller.generalSettings);
  app.put('/settings/:key', {
    config: { permissions: ['settings.manage'] },
    schema: { tags: settingTags, params: settingKeyParamSchema, body: settingUpdateSchema },
  }, controller.updateSetting);

  const auditTags = ['Auditoria'];
  app.get('/audit-logs', { config: { permissions: ['audit.read'] }, schema: { tags: auditTags, querystring: auditListQuerySchema } }, controller.listAudit);
  app.get('/audit-logs/verify', { config: { permissions: ['audit.read'] }, schema: { tags: auditTags } }, controller.verifyAudit);
}
