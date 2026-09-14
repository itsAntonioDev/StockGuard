import { ADMIN_LOCKED_PERMISSIONS, type PermissionCode } from '../auth/permissions.js';
import { BusinessRuleError, NotFoundError } from '../lib/errors.js';
import { getPrisma } from '../lib/prisma.js';
import type { RequestContext } from '../utils/request-context.js';
import { writeAudit } from './audit.service.js';

export async function listRoles() {
  const roles = await getPrisma().role.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isSystem: true,
      _count: { select: { users: true } },
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  return roles.map(({ permissions, _count, ...role }) => ({
    ...role,
    userCount: _count.users,
    permissions: permissions.map((link) => link.permission.code).sort(),
  }));
}

export async function listPermissions() {
  return getPrisma().permission.findMany({
    orderBy: [{ module: 'asc' }, { code: 'asc' }],
    select: { code: true, module: true, description: true },
  });
}

export async function updateRolePermissions(roleId: string, codes: PermissionCode[], context: RequestContext) {
  const prisma = getPrisma();
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: { select: { code: true } } } } },
  });
  if (!role) throw new NotFoundError('Perfil não encontrado.');

  const requested = [...new Set(codes)];
  if (role.code === 'ADMIN') {
    const missing = ADMIN_LOCKED_PERMISSIONS.filter((code) => !requested.includes(code));
    if (missing.length > 0) {
      throw new BusinessRuleError(
        'ADMIN_LOCKED_PERMISSIONS',
        'O perfil Administrador precisa manter as permissões de usuários, perfis e auditoria.',
        { missing },
      );
    }
  }

  const permissions = await prisma.permission.findMany({ where: { code: { in: requested } }, select: { id: true, code: true } });
  if (permissions.length !== requested.length) {
    throw new BusinessRuleError('PERMISSION_NOT_FOUND', 'Uma ou mais permissões não existem no catálogo.');
  }

  const before = role.permissions.map((link) => link.permission.code);
  const added = requested.filter((code) => !before.includes(code));
  const removed = before.filter((code) => !requested.includes(code as PermissionCode));

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permissionId: permission.id })) });
    await writeAudit(tx, context, {
      action: 'roles.permissions_update',
      result: 'SUCCESS',
      entityType: 'Role',
      entityId: roleId,
      metadata: { role: role.code, added, removed },
    });
  });
  return { added, removed };
}
