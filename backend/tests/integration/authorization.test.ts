import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../../src/lib/prisma.js';
import {
  ApiClient,
  buildTestApp,
  closeAll,
  createLayout,
  createProduct,
  createUser,
  login,
  receiveStock,
  resetDatabase,
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

describe('controle de acesso no backend', () => {
  it('sem sessão: 401 em rotas protegidas', async () => {
    expect((await new ApiClient(app).get('/products')).statusCode).toBe(401);
  });

  it('operador não acessa rotas de gestão e administração', async () => {
    const operator = await login(app, await createUser('OPERATOR'));
    expect((await operator.get('/users')).statusCode).toBe(403);
    expect((await operator.get('/analytics/dashboard')).statusCode).toBe(403);
    expect((await operator.get('/audit-logs')).statusCode).toBe(403);
    expect((await operator.post('/products', { internalCode: 'X1', name: 'Produto', unit: 'UN' })).statusCode).toBe(403);
  });

  it('conferente não registra movimentações', async () => {
    const { warehouse, a1 } = await createLayout();
    const product = await createProduct();
    const checker = await login(app, await createUser('CHECKER'));
    const response = await checker.post(
      '/movements',
      { type: 'ENTRY', warehouseId: warehouse.id, items: [{ productId: product.id, toLocationId: a1.id, quantity: 1 }] },
      { 'idempotency-key': 'chave-de-teste-0000000001' },
    );
    expect(response.statusCode).toBe(403);
  });

  it('negação de acesso fica registrada na auditoria', async () => {
    const operator = await createUser('OPERATOR');
    const client = await login(app, operator);
    await client.get('/users');
    const denied = await getPrisma().auditLog.findFirst({ where: { action: 'authz.denied', actorId: operator.id } });
    expect(denied?.result).toBe('DENIED');
  });
});

describe('escalonamento de privilégios', () => {
  it('gestor não cria administradores nem promove operadores a gestor', async () => {
    const manager = await login(app, await createUser('MANAGER'));
    const roles = await getPrisma().role.findMany();
    const roleId = (code: string) => roles.find((role) => role.code === code)!.id;

    const createAdmin = await manager.post('/users', { name: 'Tentativa Admin', email: 'novo.admin@teste.local', roleId: roleId('ADMIN') });
    expect(createAdmin.statusCode).toBe(403);

    const operator = await createUser('OPERATOR');
    const promote = await manager.patch(`/users/${operator.id}`, { roleId: roleId('MANAGER') });
    expect(promote.statusCode).toBe(403);

    const createOperator = await manager.post('/users', { name: 'Novo Operador', email: 'novo.operador@teste.local', roleId: roleId('OPERATOR') });
    expect(createOperator.statusCode).toBe(201);
    expect(createOperator.json().temporaryPassword).toHaveLength(16);
  });

  it('administrador não remove o próprio acesso nem o último administrador', async () => {
    const admin = await createUser('ADMIN');
    const client = await login(app, admin);
    const self = await client.patch(`/users/${admin.id}`, { active: false });
    expect(self.statusCode).toBe(422);

    const adminRole = await getPrisma().role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const strip = await client.put(`/roles/${adminRole.id}/permissions`, { permissions: ['products.read'] });
    expect(strip.statusCode).toBe(422);
    expect(strip.json().error.code).toBe('ADMIN_LOCKED_PERMISSIONS');
  });
});

describe('manipulação de IDs (IDOR)', () => {
  it('operador não vê movimentação concluída de outro operador', async () => {
    const { warehouse, a1 } = await createLayout();
    const product = await createProduct();
    const operatorA = await login(app, await createUser('OPERATOR'));
    const operatorB = await login(app, await createUser('OPERATOR'));
    const checker = await login(app, await createUser('CHECKER'));

    const movement = await receiveStock(operatorA, checker, {
      warehouseId: warehouse.id, productId: product.id, productCode: product.internalCode, locationId: a1.id, locationCode: a1.code, quantity: 5,
    });

    expect((await operatorA.get(`/movements/${movement.id}`)).statusCode).toBe(200);
    expect((await operatorB.get(`/movements/${movement.id}`)).statusCode).toBe(404);
    const list = await operatorB.get('/movements');
    expect(list.json().items.map((item: { id: string }) => item.id)).not.toContain(movement.id);
  });

  it('operador não vê divergências que não são dele', async () => {
    const product = await createProduct();
    const manager = await login(app, await createUser('MANAGER'));
    const operator = await login(app, await createUser('OPERATOR'));
    const created = await manager.post('/discrepancies', {
      type: 'PRODUCT_NOT_FOUND', productId: product.id, description: 'Produto não localizado durante ronda de verificação.',
    });
    expect(created.statusCode).toBe(201);
    expect((await operator.get(`/discrepancies/${created.json().id}`)).statusCode).toBe(404);
  });

  it('operador consulta apenas a própria produtividade', async () => {
    const other = await createUser('OPERATOR');
    const operator = await login(app, await createUser('OPERATOR'));
    expect((await operator.get(`/analytics/productivity?userId=${other.id}`)).statusCode).toBe(403);
    const own = await operator.get('/analytics/productivity');
    expect(own.statusCode).toBe(200);
    expect(own.json().scope).toBe('INDIVIDUAL');
  });

  it('usuário não encerra sessão de outro usuário trocando o ID', async () => {
    const victim = await createUser('OPERATOR');
    await login(app, victim);
    const session = await getPrisma().session.findFirstOrThrow({ where: { userId: victim.id } });
    const attacker = await login(app, await createUser('OPERATOR'));
    const response = await attacker.request('DELETE', `/auth/sessions/${session.id}`);
    expect(response.statusCode).toBe(400);
    expect((await getPrisma().session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
  });
});

describe('exportação', () => {
  it('CSV exige permissão própria, além de leitura de relatórios', async () => {
    const admin = await login(app, await createUser('ADMIN'));
    const managerRole = await getPrisma().role.findUniqueOrThrow({ where: { code: 'MANAGER' }, include: { permissions: { include: { permission: true } } } });
    const withoutExport = managerRole.permissions.map((link) => link.permission.code).filter((code) => code !== 'reports.export');
    expect((await admin.put(`/roles/${managerRole.id}/permissions`, { permissions: withoutExport })).statusCode).toBe(200);

    const manager = await login(app, await createUser('MANAGER'));
    expect((await manager.get('/reports/discrepancies')).statusCode).toBe(200);
    expect((await manager.get('/reports/discrepancies?format=csv')).statusCode).toBe(403);
  });
});
