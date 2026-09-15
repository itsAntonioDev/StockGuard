import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../src/auth/totp.js';
import { getPrisma } from '../../src/lib/prisma.js';
import {
  ApiClient,
  buildTestApp,
  closeAll,
  createUser,
  currentTotp,
  login,
  PASSWORD,
  resetDatabase,
  sessionCookie,
  type TestApp,
} from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await closeAll(app);
});
beforeEach(async () => {
  await resetDatabase();
});

describe('login', () => {
  it('autentica e emite cookie HttpOnly + SameSite=Strict', async () => {
    const user = await createUser('OPERATOR');
    const response = await new ApiClient(app).post('/auth/login', { email: user.email, password: PASSWORD });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ pendingStep: null });
    const cookie = response.cookies.find((entry) => entry.name === 'sg_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(String(cookie?.sameSite).toLowerCase()).toBe('strict');
  });

  it('mesma resposta para e-mail inexistente e senha errada (não revela contas)', async () => {
    const user = await createUser('OPERATOR');
    const anon = new ApiClient(app);
    const unknown = await anon.post('/auth/login', { email: 'ninguem@teste.local', password: PASSWORD });
    const wrong = await anon.post('/auth/login', { email: user.email, password: 'Senha-Errada#2026' });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('bloqueia após 5 falhas — mesmo a senha correta é recusada durante o bloqueio', async () => {
    const user = await createUser('OPERATOR');
    const anon = new ApiClient(app);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await anon.post('/auth/login', { email: user.email, password: 'Senha-Errada#2026' });
    }
    const blocked = await anon.post('/auth/login', { email: user.email, password: PASSWORD });
    expect(blocked.statusCode).toBe(401);
    const row = await getPrisma().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).not.toBeNull();
  });

  it('nunca grava senhas na auditoria', async () => {
    const user = await createUser('OPERATOR');
    await new ApiClient(app).post('/auth/login', { email: user.email, password: 'SenhaVazada-XYZ#999' });
    const logs = await getPrisma().auditLog.findMany();
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain('SenhaVazada');
  });
});

describe('sessão', () => {
  it('logout invalida a sessão no servidor', async () => {
    const client = await login(app, await createUser('OPERATOR'));
    expect((await client.post('/auth/logout')).statusCode).toBe(204);
    expect((await client.get('/auth/me')).statusCode).toBe(401);
  });

  it('sessão expirada ou ociosa é recusada', async () => {
    const user = await createUser('OPERATOR');
    const client = await login(app, user);
    await getPrisma().session.updateMany({ where: { userId: user.id }, data: { lastSeenAt: new Date(Date.now() - 3 * 3_600_000) } });
    expect((await client.get('/auth/me')).statusCode).toBe(401);
    const session = await getPrisma().session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedReason).toBe('IDLE_TIMEOUT');

    const second = await login(app, user);
    await getPrisma().session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await second.get('/auth/me')).statusCode).toBe(401);
  });

  it('usuário desativado perde o acesso imediatamente', async () => {
    const user = await createUser('OPERATOR');
    const client = await login(app, user);
    await getPrisma().user.update({ where: { id: user.id }, data: { active: false } });
    expect((await client.get('/products')).statusCode).toBe(401);
  });
});

describe('MFA e troca de senha', () => {
  it('administrador sem MFA só consegue configurar o MFA', async () => {
    const admin = await createUser('ADMIN', { mfa: false });
    const response = await new ApiClient(app).post('/auth/login', { email: admin.email, password: PASSWORD });
    expect(response.json().pendingStep).toBe('MFA_SETUP');
    const client = new ApiClient(app, sessionCookie(response));

    const blocked = await client.get('/users');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('AUTH_STEP_REQUIRED');

    const setup = await client.post('/auth/mfa/setup');
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json<{ secret: string }>();
    const confirm = await client.post('/auth/mfa/confirm', { code: hotp(base32Decode(secret), totpStep()) });
    expect(confirm.statusCode).toBe(200);

    // A sessão foi rotacionada: o token anterior deixa de valer.
    expect((await client.get('/users')).statusCode).toBe(401);
    client.token = sessionCookie(confirm);
    expect((await client.get('/users')).statusCode).toBe(200);
  });

  it('o mesmo código MFA não pode ser reutilizado', async () => {
    const admin = await createUser('ADMIN');
    const code = currentTotp(admin.totpSecret!);

    const first = await new ApiClient(app).post('/auth/login', { email: admin.email, password: PASSWORD });
    const firstClient = new ApiClient(app, sessionCookie(first));
    expect((await firstClient.post('/auth/mfa/verify', { code })).statusCode).toBe(200);

    const second = await new ApiClient(app).post('/auth/login', { email: admin.email, password: PASSWORD });
    const secondClient = new ApiClient(app, sessionCookie(second));
    expect((await secondClient.post('/auth/mfa/verify', { code })).statusCode).toBe(400);
  });

  it('senha temporária precisa ser trocada antes de usar o sistema', async () => {
    const user = await createUser('OPERATOR', { mustChangePassword: true });
    const response = await new ApiClient(app).post('/auth/login', { email: user.email, password: PASSWORD });
    expect(response.json().pendingStep).toBe('CHANGE_PASSWORD');
    const client = new ApiClient(app, sessionCookie(response));
    expect((await client.get('/products')).statusCode).toBe(403);

    const weak = await client.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'fraca' });
    expect(weak.statusCode).toBe(400);

    const changed = await client.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Nova-Senha-Forte#2026' });
    expect(changed.statusCode).toBe(200);
    client.token = sessionCookie(changed);
    expect((await client.get('/products')).statusCode).toBe(200);
  });
});

describe('proteções de requisição', () => {
  it('recusa requisições que alteram dados vindas de outra origem (CSRF)', async () => {
    const user = await createUser('OPERATOR');
    const response = await new ApiClient(app).post('/auth/login', { email: user.email, password: PASSWORD }, { origin: 'https://site-malicioso.example' });
    expect(response.statusCode).toBe(403);
  });

  it('limita tentativas de login por IP', async () => {
    const limited = await buildTestApp({ loginRateLimitMax: 2 });
    try {
      const anon = new ApiClient(limited);
      const body = { email: 'x@teste.local', password: 'Qualquer#2026' };
      await anon.post('/auth/login', body);
      await anon.post('/auth/login', body);
      expect((await anon.post('/auth/login', body)).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('erros não expõem detalhes internos', async () => {
    const client = await login(app, await createUser('OPERATOR'));
    const response = await client.get('/movements/nao-e-um-uuid');
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.requestId).toBeTruthy();
    expect(response.body).not.toMatch(/stack|prisma|at \w+ \(/iu);
    expect(response.headers['x-request-id']).toBe(body.error.requestId);
  });
});
