import { randomInt } from 'node:crypto';
import { OPERATIONAL_ROLE_CODES, type RoleCode } from '../auth/permissions.js';
import { hashPassword } from '../auth/password.js';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma } from '../lib/prisma.js';
import type { Actor } from '../types/fastify.js';
import { diffFields } from '../utils/diff.js';
import type { RequestContext } from '../utils/request-context.js';
import type { UserCreateInput, UserListQuery, UserUpdateInput } from '../validators/admin.schemas.js';
import { skipTake, toPage } from '../validators/common.js';
import { writeAudit } from './audit.service.js';
import { revokeUserSessions } from './session.service.js';

/** Campos expostos pela API — nunca hash de senha ou segredos MFA. */
const userSelect = {
  id: true,
  name: true,
  email: true,
  active: true,
  mustChangePassword: true,
  mfaEnabled: true,
  lastLoginAt: true,
  lockedUntil: true,
  failedLoginCount: true,
  trainingStartedAt: true,
  createdAt: true,
  deactivatedAt: true,
  role: { select: { id: true, code: true, name: true } },
  sector: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

/** Senha temporária forte (16 caracteres, 4 classes), exibida uma única vez. */
export function generateTemporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '#%*+-_=?'];
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = sets.map(pick);
  const all = sets.join('');
  while (chars.length < 16) chars.push(pick(all));
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [chars[index], chars[swap]] = [chars[swap]!, chars[index]!];
  }
  return chars.join('');
}

/** Gestores administram apenas perfis operacionais; administradores, todos. */
function assertCanManageRole(actor: Actor, roleCode: string) {
  if (actor.permissions.has('users.manage')) return;
  if (actor.permissions.has('users.manage_operators') && OPERATIONAL_ROLE_CODES.includes(roleCode as RoleCode)) return;
  throw new ForbiddenError('Você só pode gerenciar usuários dos perfis Operador e Conferente.');
}

async function findRole(roleId: string) {
  const role = await getPrisma().role.findUnique({ where: { id: roleId }, select: { id: true, code: true } });
  if (!role) throw new BusinessRuleError('ROLE_NOT_FOUND', 'Perfil não encontrado.');
  return role;
}

async function assertSectorActive(sectorId: string | null | undefined) {
  if (!sectorId) return;
  const sector = await getPrisma().sector.findUnique({ where: { id: sectorId }, select: { active: true } });
  if (!sector?.active) throw new BusinessRuleError('SECTOR_INVALID', 'Setor não encontrado ou inativo.');
}

export async function listUsers(query: UserListQuery) {
  const prisma = getPrisma();
  const where: Prisma.UserWhereInput = {
    ...(query.search
      ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search.toLowerCase() } }] }
      : {}),
    ...(query.roleId ? { roleId: query.roleId } : {}),
    ...(query.active ? { active: query.active === 'true' } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, ...skipTake(query.page, query.pageSize) }),
  ]);
  return toPage(items, total, query.page, query.pageSize);
}

export async function getUser(userId: string) {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user) throw new NotFoundError('Usuário não encontrado.');
  return user;
}

export async function createUser(actor: Actor, input: UserCreateInput, context: RequestContext) {
  const role = await findRole(input.roleId);
  assertCanManageRole(actor, role.code);
  await assertSectorActive(input.sectorId);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    const user = await getPrisma().$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          roleId: role.id,
          sectorId: input.sectorId ?? null,
          trainingStartedAt: input.trainingStartedAt ?? null,
          mustChangePassword: true,
        },
        select: userSelect,
      });
      await writeAudit(tx, context, {
        action: 'users.create',
        result: 'SUCCESS',
        entityType: 'User',
        entityId: created.id,
        metadata: { role: role.code, sectorId: created.sector?.id ?? null },
      });
      return created;
    });
    return { user, temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('Já existe um usuário com este e-mail.', 'EMAIL_ALREADY_USED');
    }
    throw error;
  }
}

async function loadTarget(actor: Actor, userId: string) {
  const target = await getPrisma().user.findUnique({ where: { id: userId }, include: { role: { select: { id: true, code: true } } } });
  if (!target) throw new NotFoundError('Usuário não encontrado.');
  assertCanManageRole(actor, target.role.code);
  return target;
}

async function assertNotLastAdmin(userId: string) {
  const others = await getPrisma().user.count({ where: { id: { not: userId }, active: true, role: { code: 'ADMIN' } } });
  if (others === 0) {
    throw new BusinessRuleError('LAST_ADMIN', 'Não é possível remover o último administrador ativo do sistema.');
  }
}

export async function updateUser(actor: Actor, userId: string, input: UserUpdateInput, context: RequestContext) {
  const target = await loadTarget(actor, userId);
  const isSelf = target.id === actor.userId;

  const roleChanged = input.roleId !== undefined && input.roleId !== target.roleId;
  const deactivating = input.active === false && target.active;
  if (isSelf && (roleChanged || deactivating)) {
    throw new BusinessRuleError('SELF_CHANGE_FORBIDDEN', 'Você não pode alterar o próprio perfil nem desativar a própria conta.');
  }

  let newRoleCode = target.role.code;
  if (roleChanged) {
    const role = await findRole(input.roleId!);
    assertCanManageRole(actor, role.code);
    newRoleCode = role.code;
  }
  if (target.role.code === 'ADMIN' && (deactivating || (roleChanged && newRoleCode !== 'ADMIN'))) {
    await assertNotLastAdmin(target.id);
  }
  if (input.sectorId) await assertSectorActive(input.sectorId);

  const data: Prisma.UserUncheckedUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
    ...(input.sectorId !== undefined ? { sectorId: input.sectorId } : {}),
    ...(input.trainingStartedAt !== undefined ? { trainingStartedAt: input.trainingStartedAt } : {}),
    ...(input.active !== undefined ? { active: input.active, deactivatedAt: input.active ? null : new Date() } : {}),
  };
  const changes = diffFields(target as unknown as Record<string, unknown>, data as Record<string, unknown>);

  return getPrisma().$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data, select: userSelect });
    let revokedSessions = 0;
    if (deactivating || roleChanged) {
      revokedSessions = await revokeUserSessions(tx, userId, deactivating ? 'USER_DEACTIVATED' : 'ROLE_CHANGED');
    }
    await writeAudit(tx, context, {
      action: roleChanged ? 'users.role_change' : 'users.update',
      result: 'SUCCESS',
      entityType: 'User',
      entityId: userId,
      metadata: { changes, fromRole: target.role.code, toRole: newRoleCode, revokedSessions },
    });
    return user;
  });
}

export async function resetPassword(actor: Actor, userId: string, context: RequestContext) {
  const target = await loadTarget(actor, userId);
  if (target.id === actor.userId) {
    throw new BusinessRuleError('SELF_RESET_FORBIDDEN', 'Para trocar a própria senha, use a opção Minha conta.');
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await getPrisma().$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    const revokedSessions = await revokeUserSessions(tx, userId, 'PASSWORD_RESET');
    await writeAudit(tx, context, { action: 'users.password_reset', result: 'SUCCESS', entityType: 'User', entityId: userId, metadata: { revokedSessions } });
  });
  return { temporaryPassword };
}

export async function resetMfa(actor: Actor, userId: string, context: RequestContext) {
  const target = await loadTarget(actor, userId);
  if (target.id === actor.userId) {
    throw new BusinessRuleError('SELF_RESET_FORBIDDEN', 'Outro administrador deve redefinir o seu MFA.');
  }
  await getPrisma().$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastUsedStep: null },
    });
    const revokedSessions = await revokeUserSessions(tx, userId, 'MFA_RESET');
    await writeAudit(tx, context, { action: 'users.mfa_reset', result: 'SUCCESS', entityType: 'User', entityId: userId, metadata: { revokedSessions } });
  });
}

export async function unlockUser(actor: Actor, userId: string, context: RequestContext) {
  await loadTarget(actor, userId);
  await getPrisma().$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
    await writeAudit(tx, context, { action: 'users.unlock', result: 'SUCCESS', entityType: 'User', entityId: userId });
  });
}
