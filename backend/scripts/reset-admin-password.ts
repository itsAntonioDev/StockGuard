/**
 * Acesso de emergência: redefine a senha de um usuário quando ninguém consegue
 * entrar pela tela (ex.: o único administrador esqueceu a senha).
 *
 *   npm run admin:reset-password -- email@empresa.com
 *   npm run admin:reset-password -- email@empresa.com --reset-mfa   (perdeu também o app autenticador)
 *
 * Gera uma senha temporária exibida uma única vez, exige troca no próximo login,
 * desbloqueia a conta, encerra as sessões abertas e registra tudo na auditoria.
 * Requer acesso ao banco (.env) — rode apenas no seu computador, nunca em servidor compartilhado.
 */
import { hashPassword } from '../src/auth/password.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { writeAudit } from '../src/services/audit.service.js';
import { revokeUserSessions } from '../src/services/session.service.js';
import { generateTemporaryPassword } from '../src/services/user.service.js';

const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith('--'))?.trim().toLowerCase();
const resetMfa = args.includes('--reset-mfa');

try {
  if (!email) throw new Error('Informe o e-mail: npm run admin:reset-password -- email@empresa.com [--reset-mfa]');

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, active: true, role: { select: { name: true } } } });
  if (!user) throw new Error(`Nenhum usuário com o e-mail ${email}.`);
  if (!user.active) throw new Error('O usuário está inativo. Reative-o antes de redefinir a senha.');

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        ...(resetMfa ? { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastUsedStep: null } : {}),
      },
    });
    const revokedSessions = await revokeUserSessions(tx, user.id, 'PASSWORD_RESET');
    await writeAudit(tx, { userAgent: 'script reset-admin-password', actorId: null }, {
      action: 'users.password_reset',
      result: 'SUCCESS',
      entityType: 'User',
      entityId: user.id,
      metadata: { revokedSessions, via: 'cli', mfaReset: resetMfa },
    });
  });

  console.log(`\nSenha redefinida para ${user.name} (${user.role.name}).`);
  console.log(`Senha temporária (exibida só agora): ${temporaryPassword}`);
  console.log('No próximo login será exigida uma nova senha.');
  if (resetMfa) console.log('MFA redefinido: configure o app autenticador novamente após entrar.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
