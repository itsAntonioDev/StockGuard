import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAuditChain } from '../services/audit.service.js';
import { listAuditLogs } from '../services/audit-query.service.js';
import * as roleService from '../services/role.service.js';
import * as settingsService from '../services/settings.service.js';
import * as userService from '../services/user.service.js';
import { getActor, requestContext } from '../utils/request-context.js';
import type {
  AuditListQuery,
  RolePermissionsInput,
  UserCreateInput,
  UserListQuery,
  UserUpdateInput,
} from '../validators/admin.schemas.js';

type IdParams = { Params: { id: string } };

// Usuários
export const listUsers = (request: FastifyRequest<{ Querystring: UserListQuery }>) => userService.listUsers(request.query);

export const getUser = (request: FastifyRequest<IdParams>) => userService.getUser(request.params.id);

export async function createUser(request: FastifyRequest<{ Body: UserCreateInput }>, reply: FastifyReply) {
  const result = await userService.createUser(getActor(request), request.body, requestContext(request));
  return reply.status(201).send(result);
}

export const updateUser = (request: FastifyRequest<IdParams & { Body: UserUpdateInput }>) =>
  userService.updateUser(getActor(request), request.params.id, request.body, requestContext(request));

export const resetPassword = (request: FastifyRequest<IdParams>) =>
  userService.resetPassword(getActor(request), request.params.id, requestContext(request));

export async function resetMfa(request: FastifyRequest<IdParams>, reply: FastifyReply) {
  await userService.resetMfa(getActor(request), request.params.id, requestContext(request));
  return reply.status(204).send();
}

export async function unlockUser(request: FastifyRequest<IdParams>, reply: FastifyReply) {
  await userService.unlockUser(getActor(request), request.params.id, requestContext(request));
  return reply.status(204).send();
}

// Perfis e permissões
export const listRoles = async () => ({ items: await roleService.listRoles() });

export const listPermissions = async () => ({ items: await roleService.listPermissions() });

export const updateRolePermissions = (request: FastifyRequest<IdParams & { Body: RolePermissionsInput }>) =>
  roleService.updateRolePermissions(request.params.id, request.body.permissions, requestContext(request));

// Configurações
export const listSettings = async () => ({ items: await settingsService.listSettings() });

export const updateSetting = (request: FastifyRequest<{ Params: { key: string }; Body: { value?: unknown } }>) =>
  settingsService.updateSetting(request.params.key, request.body.value, getActor(request).userId, requestContext(request));

// Auditoria
export const listAudit = (request: FastifyRequest<{ Querystring: AuditListQuery }>) => listAuditLogs(request.query);

export const verifyAudit = () => verifyAuditChain();
