import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../../src/lib/prisma.js';
import {
  buildTestApp,
  closeAll,
  createLayout,
  createProduct,
  createUser,
  login,
  migratorClient,
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

describe('exclusão de produtos', () => {
  it('exclui cadastro sem histórico e registra na auditoria', async () => {
    const admin = await login(app, await createUser('ADMIN'));
    const product = await createProduct();

    const response = await admin.delete(`/products/${product.id}`);

    expect(response.statusCode).toBe(204);
    expect(await getPrisma().product.findUnique({ where: { id: product.id } })).toBeNull();
    const audit = await getPrisma().auditLog.findFirst({ where: { action: 'products.delete', entityId: product.id } });
    expect(audit).not.toBeNull();
  });

  it('recusa excluir produto com histórico e preserva o cadastro', async () => {
    const layout = await createLayout();
    const operator = await login(app, await createUser('OPERATOR'));
    const checker = await login(app, await createUser('CHECKER'));
    const admin = await login(app, await createUser('ADMIN'));
    const product = await createProduct();
    await receiveStock(operator, checker, {
      warehouseId: layout.warehouse.id,
      productId: product.id,
      productCode: product.internalCode,
      locationId: layout.a1.id,
      locationCode: layout.a1.code,
      quantity: 5,
    });

    const response = await admin.delete(`/products/${product.id}`);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'PRODUCT_HAS_HISTORY' } });
    expect(await getPrisma().product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });

  it('operador não pode excluir produtos', async () => {
    const operator = await login(app, await createUser('OPERATOR'));
    const product = await createProduct();

    expect((await operator.delete(`/products/${product.id}`)).statusCode).toBe(403);
    expect(await getPrisma().product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });
});

describe('exclusão de lotes', () => {
  it('exclui lote nunca utilizado', async () => {
    const admin = await login(app, await createUser('ADMIN'));
    const product = await createProduct({ tracksLot: true });
    const created = await admin.post(`/products/${product.id}/lots`, { code: 'LOTE-1' });
    expect(created.statusCode).toBe(201);
    const lotId = created.json<{ id: string }>().id;

    expect((await admin.delete(`/lots/${lotId}`)).statusCode).toBe(204);
    expect(await getPrisma().lot.findUnique({ where: { id: lotId } })).toBeNull();
  });

  it('recusa excluir lote já usado no estoque', async () => {
    const layout = await createLayout();
    const admin = await login(app, await createUser('ADMIN'));
    const product = await createProduct({ tracksLot: true });
    const created = await admin.post(`/products/${product.id}/lots`, { code: 'LOTE-2' });
    const lotId = created.json<{ id: string }>().id;
    // Saldo é escrito apenas pela função do banco; nos testes, o papel dono simula o uso do lote.
    await migratorClient().stockBalance.create({ data: { productId: product.id, locationId: layout.a1.id, lotId, quantity: '3' } });

    const response = await admin.delete(`/lots/${lotId}`);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'LOT_HAS_HISTORY' } });
    expect(await getPrisma().lot.findUnique({ where: { id: lotId } })).not.toBeNull();
  });
});
