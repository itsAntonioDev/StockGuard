import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../../src/lib/prisma.js';
import {
  balanceOf,
  buildTestApp,
  closeAll,
  createLayout,
  createProduct,
  createUser,
  idempotencyKey,
  login,
  multipartFile,
  receiveStock,
  resetDatabase,
  type ApiClient,
  type TestApp,
} from './helpers.js';

let app: TestApp;
let layout: Awaited<ReturnType<typeof createLayout>>;
let product: Awaited<ReturnType<typeof createProduct>>;
let operator: ApiClient;
let checker: ApiClient;
let manager: ApiClient;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await closeAll(app);
});
beforeEach(async () => {
  await resetDatabase();
  layout = await createLayout();
  product = await createProduct({ unitCost: '4.00' });
  operator = await login(app, await createUser('OPERATOR'));
  checker = await login(app, await createUser('CHECKER'));
  manager = await login(app, await createUser('MANAGER'));
});

const stockIn = (quantity: number, location = layout.a1) =>
  receiveStock(operator, checker, {
    warehouseId: layout.warehouse.id, productId: product.id, productCode: product.internalCode, locationId: location.id, locationCode: location.code, quantity,
  });

const newDiscrepancy = (client: ApiClient, extra: Record<string, unknown> = {}) =>
  client.post('/discrepancies', {
    type: 'QUANTITY_MISMATCH',
    productId: product.id,
    locationId: layout.a1.id,
    expectedQuantity: '10',
    foundQuantity: '7',
    description: 'Contagem de verificação encontrou 7 unidades no endereço.',
    ...extra,
  });

describe('divergências', () => {
  it('registro cria divergência aberta, com histórico e valor estimado', async () => {
    const response = await newDiscrepancy(manager);
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('OPEN');
    expect(body.estimatedValue).toBe(12);
    expect(body.actions[0].kind).toBe('CREATED');
  });

  it('fluxo de resolução exige análise, causa provável e ação corretiva; finalizada é imutável', async () => {
    const { id } = (await newDiscrepancy(manager)).json();
    expect((await manager.post(`/discrepancies/${id}/status`, { status: 'CORRECTED' })).statusCode).toBe(422);
    expect((await manager.post(`/discrepancies/${id}/status`, { status: 'IN_ANALYSIS' })).statusCode).toBe(200);
    expect((await manager.post(`/discrepancies/${id}/status`, { status: 'CORRECTED' })).statusCode).toBe(422);

    const corrected = await manager.post(`/discrepancies/${id}/status`, {
      status: 'CORRECTED', probableCause: 'LABELING', correctiveAction: 'Etiqueta do endereço refeita e produto recontado.',
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().resolvedAt).not.toBeNull();

    expect((await manager.post(`/discrepancies/${id}/status`, { status: 'DISCARDED', note: 'teste' })).statusCode).toBe(422);
    // Comentários continuam permitidos (contexto do operador após a análise).
    expect((await manager.post(`/discrepancies/${id}/comments`, { note: 'Treinamento agendado.' })).statusCode).toBe(200);
  });

  it('operador vê a divergência ligada à própria operação — sem culpa atribuída automaticamente', async () => {
    const movement = await stockIn(10);
    const item = await getPrisma().stockMovementItem.findFirstOrThrow({ where: { movementId: movement.id } });
    const created = await newDiscrepancy(manager, { movementItemId: item.id });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.probableCause).toBe('NOT_DETERMINED');
    expect((await operator.get(`/discrepancies/${body.id}`)).statusCode).toBe(200);
  });

  it('divergências recorrentes do mesmo produto geram alerta', async () => {
    for (let index = 0; index < 3; index += 1) await newDiscrepancy(manager);
    const alert = await getPrisma().alert.findFirst({ where: { type: 'RECURRING_DISCREPANCY', productId: product.id } });
    expect(alert?.status).toBe('OPEN');
  });

  it('evidências: aceita imagem real, recusa arquivo disfarçado e força download', async () => {
    const { id } = (await newDiscrepancy(manager)).json();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const good = multipartFile('foto.png', png, 'image/png');
    const uploaded = await manager.request('POST', `/discrepancies/${id}/evidences`, undefined, good.headers, good.payload);
    expect(uploaded.statusCode).toBe(201);

    const fake = multipartFile('foto.png', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png');
    expect((await manager.request('POST', `/discrepancies/${id}/evidences`, undefined, fake.headers, fake.payload)).statusCode).toBe(400);

    const download = await manager.get(`/discrepancies/${id}/evidences/${uploaded.json().id}`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment/u);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('inventário', () => {
  it('congela os endereços do escopo enquanto está aberto', async () => {
    await stockIn(10);
    const opened = await manager.post('/inventories', { warehouseId: layout.warehouse.id, sectorId: layout.sectorA.id });
    expect(opened.statusCode).toBe(201);

    const blocked = await operator.post(
      '/movements',
      { type: 'ENTRY', warehouseId: layout.warehouse.id, items: [{ productId: product.id, toLocationId: layout.a2.id, quantity: 1 }] },
      { 'idempotency-key': idempotencyKey() },
    );
    expect(blocked.statusCode).toBe(422);
    expect(JSON.stringify(blocked.json())).toContain('LOCATION_UNDER_INVENTORY');
  });

  it('não abre com operações pendentes no escopo', async () => {
    await operator.post(
      '/movements',
      { type: 'ENTRY', warehouseId: layout.warehouse.id, items: [{ productId: product.id, toLocationId: layout.a1.id, quantity: 1 }] },
      { 'idempotency-key': idempotencyKey() },
    );
    const response = await manager.post('/inventories', { warehouseId: layout.warehouse.id, sectorId: layout.sectorA.id });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('PENDING_MOVEMENTS_IN_SCOPE');
  });

  it('contagem cega, envio gera divergências e aprovação por outra pessoa ajusta o estoque', async () => {
    await stockIn(10);
    const inventory = (await manager.post('/inventories', { warehouseId: layout.warehouse.id, sectorId: layout.sectorA.id })).json();

    const operatorItems = await operator.get(`/inventories/${inventory.id}/items`);
    expect(operatorItems.json().items[0].systemQuantity).toBeNull();
    const managerItems = await manager.get(`/inventories/${inventory.id}/items`);
    expect(managerItems.json().items[0].systemQuantity).toBe(10);

    expect((await manager.post(`/inventories/${inventory.id}/submit`)).json().error.code).toBe('INVENTORY_ITEMS_PENDING');

    const count = await operator.post(`/inventories/${inventory.id}/counts`, { locationCode: layout.a1.code, productCode: product.internalCode, quantity: '7' });
    expect(count.statusCode).toBe(200);
    expect(count.json().item.systemQuantity).toBeNull();

    const submitted = await manager.post(`/inventories/${inventory.id}/submit`);
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().discrepancies).toBe(1);

    expect((await manager.post(`/inventories/${inventory.id}/approve`)).statusCode).toBe(422);
    expect(await balanceOf(product.id, layout.a1.id)).toBe(10);

    const otherManager = await login(app, await createUser('MANAGER'));
    const approved = await otherManager.post(`/inventories/${inventory.id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('APPROVED');
    expect(await balanceOf(product.id, layout.a1.id)).toBe(7);

    const movement = await getPrisma().stockMovement.findUniqueOrThrow({ where: { id: approved.json().movement.id } });
    expect(movement.type).toBe('INVENTORY');
    expect(movement.status).toBe('CONFIRMED');
  });
});

describe('indicadores e relatórios', () => {
  it('taxa de divergência segue a fórmula documentada', async () => {
    await stockIn(10);
    const pending = await operator.post(
      '/movements',
      { type: 'ENTRY', warehouseId: layout.warehouse.id, items: [{ productId: product.id, toLocationId: layout.a2.id, quantity: 10 }] },
      { 'idempotency-key': idempotencyKey() },
    );
    const movement = pending.json().movement;
    await manager.post(`/movements/${movement.id}/confirm`, {
      items: [{ itemId: movement.items[0].id, locationCode: layout.a2.code, productCode: product.internalCode, quantity: '9' }],
      varianceReason: 'Uma unidade avariada no recebimento.',
    });

    const dashboard = await manager.get('/analytics/dashboard');
    expect(dashboard.statusCode).toBe(200);
    const { metrics } = dashboard.json();
    expect(metrics.analyzedOperations).toBe(2);
    expect(metrics.operationsWithDiscrepancy).toBe(1);
    expect(metrics.discrepancyRate).toBe(50);
  });

  it('exportação CSV neutraliza fórmulas e fica auditada', async () => {
    await getPrisma().product.update({ where: { id: product.id }, data: { name: '=HYPERLINK("http://malicioso")' } });
    await stockIn(3);
    const csv = await manager.get('/reports/movements?format=csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain(`"'=HYPERLINK`);
    expect(await getPrisma().auditLog.count({ where: { action: 'reports.export', result: 'SUCCESS' } })).toBe(1);
  });

  it('produtividade da operação não lista pessoas', async () => {
    await stockIn(3);
    const response = await manager.get('/analytics/productivity');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.scope).toBe('OPERATION');
    expect(body.individual).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/ranking/iu);
  });
});
