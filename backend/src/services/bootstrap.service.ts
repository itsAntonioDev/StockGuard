import { PERMISSIONS, ROLE_CODES, ROLE_DEFINITIONS } from '../auth/permissions.js';
import { hashPassword, validatePasswordPolicy } from '../auth/password.js';
import type { DbClient } from '../lib/prisma.js';
import { writeAudit } from './audit.service.js';

/**
 * Sincroniza o catálogo de permissões e os perfis de sistema.
 * Vínculos perfil→permissão só são (re)definidos quando o perfil é criado ou
 * quando solicitado explicitamente — ajustes feitos pelo administrador são preservados.
 */
export async function syncPermissionsAndRoles(db: DbClient, options: { resetRolePermissions?: boolean } = {}) {
  for (const [code, definition] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { code },
      create: { code, module: definition.module, description: definition.description },
      update: { module: definition.module, description: definition.description },
    });
  }
  const permissions = await db.permission.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));

  const summary: Array<{ role: string; created: boolean; permissionsSynced: boolean }> = [];
  for (const code of ROLE_CODES) {
    const definition = ROLE_DEFINITIONS[code];
    const existing = await db.role.findUnique({ where: { code }, select: { id: true } });
    const role = existing
      ? await db.role.update({ where: { code }, data: { name: definition.name, description: definition.description, isSystem: true }, select: { id: true } })
      : await db.role.create({ data: { code, name: definition.name, description: definition.description, isSystem: true }, select: { id: true } });

    const sync = !existing || options.resetRolePermissions === true;
    if (sync) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.rolePermission.createMany({
        data: definition.permissions.map((permission) => ({ roleId: role.id, permissionId: idByCode.get(permission)! })),
      });
    }
    summary.push({ role: code, created: !existing, permissionsSynced: sync });
  }
  return summary;
}

export interface InitialAdminInput {
  name: string;
  email: string;
  password: string;
}

/** Cria o primeiro administrador apenas se ainda não existir nenhum. */
export async function ensureInitialAdmin(db: DbClient, input: InitialAdminInput): Promise<'created' | 'already-exists'> {
  const admins = await db.user.count({ where: { role: { code: 'ADMIN' } } });
  if (admins > 0) return 'already-exists';

  const email = input.email.trim().toLowerCase();
  const problems = validatePasswordPolicy(input.password, { email, name: input.name });
  if (problems.length > 0) throw new Error(`SEED_ADMIN_PASSWORD não atende à política de senhas: ${problems.join(' ')}`);

  const role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } });
  const user = await db.user.create({
    data: { name: input.name, email, passwordHash: await hashPassword(input.password), roleId: role.id, mustChangePassword: true },
    select: { id: true },
  });
  await writeAudit(db, { requestId: 'seed' }, {
    action: 'users.create',
    result: 'SUCCESS',
    entityType: 'User',
    entityId: user.id,
    metadata: { role: 'ADMIN', source: 'seed' },
  });
  return 'created';
}
