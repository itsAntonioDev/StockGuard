import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../../src/lib/prisma.js';
import { verifyAuditChain } from '../../src/services/audit.service.js';
import {
  balanceOf,
  buildTestApp,
  closeAll,
  createLayout,
  createProduct,
  createUser,
  idempotencyKey,
  login,
  migratorClient,
  receiveStock,
  resetDatabase,
  type ApiClient,
  type MovementResponse,
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
  product = await createProduct({ internalCode: '12345', barcode: '7891000100103', unitCost: '12.50' });
  operator = await login(app, await createUser('OPERATOR'));
  checker = await login(app, await createUser('CHECKER'));
  manager = await login(app, await createUser('MANAGER'));
});

const stockIn = (quantity: number, productRow = product, location = layout.a1) =>
  receiveStock(operator, checker, {
    warehouseId: layout.warehouse.id,
    productId: productRow.id,
    productCode: productRow.internalCode,
    locationId: location.id,
    locationCode: location.code,
    quantity,
  });

const createMovement = (client: ApiClient, body: Record<string, unknown>, key = idempotencyKey()) =>
  client.post('/movements', { warehouseId: layout.warehouse.id, ...body }, { 'idempotency-key': key });

describe('validações antes de registrar', () => {
  it('produto inexistente', async () => {
    const response = await createMovement(operator, { type: 'ENTRY', items: [{ productId: '00000000-0000-4000-8000-000000000000', toLocationId: layout.a1.id, quantity: 1 }] });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.problems[0].code).toBe('PRODUCT_NOT_FOUND');
  });

  it.each([0, -1, '1.2345', 'abc'])('quantidade inválida: %s', async (quantity) => {
    const response = await createMovement(operator, { type: 'ENTRY', items: [{ productId: product.id, toLocationId: layout.a1.id, quantity }] });
    expect(response.statusCode).toBe(400);
  });

  it('quantidade fracionada em unidade inteira', async () => {
    const response = await createMovement(operator, { type: 'ENTRY', items: [{ productId: product.id, toLocationId: layout.a1.id, quantity: '1.5' }] });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.problems[0].code).toBe('INVALID_QUANTITY_FOR_UNIT');
  });

  it('estoque insuficiente é recusado e gera alerta', async () => {
    await stockIn(3);
    const response = await createMovement(operator, { type: 'EXIT', items: [{ productId: product.id, fromLocationId: layout.a1.id, quantity: 5 }] });
    expect(response.statusCode).toBe(422);
    const problem = response.json().error.details.problems[0];
    expect(problem.code).toBe('INSUFFICIENT_STOCK');
    expect(problem.message).toContain('Disponível: 3');
    expect(await getPrisma().alert.count({ where: { type: 'NEGATIVE_STOCK_ATTEMPT' } })).toBe(1);
  });

  it('sem chave de idempotência a operação crítica é recusada', async () => {
    const response = await operator.post('/movements', { type: 'ENTRY', warehouseId: layout.warehouse.id, items: [{ productId: product.id, toLocationId: layout.a1.id, quantity: 1 }] });
    expect(response.statusCode).toBe(400);
  });
});

describe('conferência', () => {
  async function pendingEntry(quantity = 10) {
    const response = await createMovement(operator, { type: 'ENTRY', items: [{ productId: product.id, toLocationId: layout.a1.id, quantity }] });
    expect(response.statusCode).toBe(201);
    return response.json<MovementResponse>().movement;
  }

  it('endereço incorreto bloqueia a confirmação e não altera o estoque', async () => {
    const movement = await pendingEntry();
    const response = await checker.post(`/movements/${movement.id}/confirm`, {
      items: [{ itemId: movement.items[0]!.id, locationCode: layout.a2.code, productCode: product.barcode!, quantity: '10' }],
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CHECK_FAILED');
    expect(response.json().error.details.items[0].errors[0].code).toBe('WRONG_LOCATION');
    expect(await balanceOf(product.id, layout.a1.id)).toBe(0);
    expect(await getPrisma().checkAttempt.count({ where: { movementId: movement.id, result: 'MISMATCH' } })).toBe(1);
  });

  it('produto incorreto mostra esperado e informado', async () => {
    const other = await createProduct({ internalCode: '67890' });
    const movement = await pendingEntry();
    const response = await checker.post(`/movements/${movement.id}/check`, {
      itemId: movement.items[0]!.id, locationCode: layout.a1.code, productCode: other.internalCode, quantity: '10',
    });
    expect(response.statusCode).toBe(200);
    const [error] = response.json().errors;
    expect(error.code).toBe('WRONG_PRODUCT');
    expect(error.message).toContain('Produto esperado: Código 12345');
    expect(error.message).toContain('Produto informado: Código 67890');
  });

  it('quem registrou não confere a própria operação (dupla checagem)', async () => {
    const movement = await pendingEntry();
    const response = await operator.post(`/movements/${movement.id}/confirm`, {
      items: [{ itemId: movement.items[0]!.id, locationCode: layout.a1.code, productCode: product.internalCode, quantity: '10' }],
    });
    expect(response.statusCode).toBe(403);
  });

  it('diferença de quantidade: operador não confirma; gestor confirma com justificativa e gera divergência', async () => {
    const movement = await pendingEntry(10);
    const body = { items: [{ itemId: movement.items[0]!.id, locationCode: layout.a1.code, productCode: product.internalCode, quantity: '8' }] };
    const byChecker = await checker.post(`/movements/${movement.id}/confirm`, body);
    expect(byChecker.statusCode).toBe(422);
    expect(byChecker.json().error.code).toBe('QUANTITY_VARIANCE');

    const byManager = await manager.post(`/movements/${movement.id}/confirm`, { ...body, varianceReason: 'Fornecedor entregou 8 unidades; nota fiscal registra 10.' });
    expect(byManager.statusCode).toBe(200);
    expect(await balanceOf(product.id, layout.a1.id)).toBe(8);

    const discrepancy = await getPrisma().discrepancy.findFirstOrThrow({ where: { movementId: movement.id } });
    expect(discrepancy.type).toBe('QUANTITY_MISMATCH');
    expect(discrepancy.probableCause).toBe('NOT_DETERMINED');
    expect(discrepancy.estimatedValue?.toString()).toBe('25');
  });
});

describe('idempotência e concorrência', () => {
  it('repetição com a mesma chave devolve a mesma movimentação; chave reutilizada em outra operação é recusada', async () => {
    const key = idempotencyKey();
    const body = { type: 'ENTRY', items: [{ productId: product.id, toLocationId: layout.a1.id, quantity: 4 }] };
    const first = await createMovement(operator, body, key);
    const second = await createMovement(operator, body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().movement.id).toBe(first.json().movement.id);
    expect(await getPrisma().stockMovement.count()).toBe(1);

    const reused = await createMovement(operator, { ...body, items: [{ productId: product.id, toLocationId: layout.a1.id, quantity: 5 }] }, key);
    expect(reused.statusCode).toBe(409);
  });

  it('confirmações simultâneas nunca deixam o saldo negativo', async () => {
    await stockIn(5);
    const exits: MovementResponse['movement'][] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await createMovement(operator, { type: 'EXIT', items: [{ productId: product.id, fromLocationId: layout.a1.id, quantity: 1 }] });
      expect(response.statusCode).toBe(201);
      exits.push(response.json<MovementResponse>().movement);
    }

    const results = await Promise.all(
      exits.map((movement) =>
        checker.post(`/movements/${movement.id}/confirm`, {
          items: [{ itemId: movement.items[0]!.id, locationCode: layout.a1.code, productCode: product.internalCode, quantity: '1' }],
        }),
      ),
    );

    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(5);
    const failures = results.filter((response) => response.statusCode !== 200);
    expect(failures).toHaveLength(5);
    for (const failure of failures) expect(failure.json().error.code).toBe('INSUFFICIENT_STOCK');

    expect(await balanceOf(product.id, layout.a1.id)).toBe(0);
    const ledger = await getPrisma().stockLedgerEntry.aggregate({ where: { productId: product.id }, _sum: { delta: true } });
    expect(Number(ledger._sum.delta)).toBe(0);
  });

  it('falha no meio da transação desfaz todos os itens', async () => {
    const productB = await createProduct();
    await stockIn(5);
    await stockIn(3, productB);

    const transfer = await createMovement(operator, {
      type: 'TRANSFER',
      items: [
        { productId: product.id, fromLocationId: layout.a1.id, toLocationId: layout.b1.id, quantity: 2 },
        { productId: productB.id, fromLocationId: layout.a1.id, toLocationId: layout.b1.id, quantity: 3 },
      ],
    });
    expect(transfer.statusCode).toBe(201);
    const pending = transfer.json<MovementResponse>().movement;

    // Outra operação consome o saldo do produto B antes da conferência da transferência.
    const exit = await createMovement(operator, { type: 'EXIT', items: [{ productId: productB.id, fromLocationId: layout.a1.id, quantity: 3 }] });
    const exitMovement = exit.json<MovementResponse>().movement;
    expect((await checker.post(`/movements/${exitMovement.id}/confirm`, {
      items: [{ itemId: exitMovement.items[0]!.id, locationCode: layout.a1.code, productCode: productB.internalCode, quantity: '3' }],
    })).statusCode).toBe(200);

    const itemFor = (productId: string) => pending.items.find((item) => item.productId === productId)!;
    const confirm = await checker.post(`/movements/${pending.id}/confirm`, {
      items: [
        { itemId: itemFor(product.id).id, locationCode: layout.a1.code, destinationCode: layout.b1.code, productCode: product.internalCode, quantity: '2' },
        { itemId: itemFor(productB.id).id, locationCode: layout.a1.code, destinationCode: layout.b1.code, productCode: productB.internalCode, quantity: '3' },
      ],
    });
    expect(confirm.statusCode).toBe(422);

    expect(await balanceOf(product.id, layout.a1.id)).toBe(5);
    expect(await balanceOf(product.id, layout.b1.id)).toBe(0);
    expect(await getPrisma().stockLedgerEntry.count({ where: { movementId: pending.id } })).toBe(0);
    const reloaded = await getPrisma().stockMovement.findUniqueOrThrow({ where: { id: pending.id }, include: { items: true } });
    expect(reloaded.status).toBe('PENDING_CHECK');
    expect(reloaded.items.every((item) => item.quantity === null)).toBe(true);
  });
});

describe('ajustes', () => {
  it('quem solicita não aprova; outro gestor aprova e o estoque é ajustado', async () => {
    await stockIn(10);
    const request = await createMovement(manager, {
      type: 'ADJUSTMENT',
      reason: 'Avaria constatada em 2 unidades durante a arrumação.',
      items: [{ productId: product.id, fromLocationId: layout.a1.id, quantity: 2, direction: 'OUT' }],
    });
    expect(request.statusCode).toBe(201);
    const movement = request.json<MovementResponse>().movement;
    expect(movement.status).toBe('PENDING_APPROVAL');

    const self = await manager.post(`/movements/${movement.id}/approve`);
    expect(self.statusCode).toBe(422);
    expect(await balanceOf(product.id, layout.a1.id)).toBe(10);

    const otherManager = await login(app, await createUser('MANAGER'));
    expect((await otherManager.post(`/movements/${movement.id}/approve`)).statusCode).toBe(200);
    expect(await balanceOf(product.id, layout.a1.id)).toBe(8);
  });

  it('ajuste sem justificativa é recusado', async () => {
    const response = await createMovement(manager, { type: 'ADJUSTMENT', items: [{ productId: product.id, toLocationId: layout.a1.id, quantity: 1, direction: 'IN' }] });
    expect(response.statusCode).toBe(400);
  });
});

describe('integridade no banco (defesa em profundidade)', () => {
  it('o papel da API não altera saldo, ledger ou auditoria diretamente', async () => {
    await stockIn(5);
    const prisma = getPrisma();
    await expect(prisma.$executeRaw`UPDATE "stock_balances" SET "quantity" = 999`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM "stock_ledger_entries"`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "audit_logs" SET "action" = 'x'`).rejects.toThrow();
    expect(await balanceOf(product.id, layout.a1.id)).toBe(5);
  });

  it('nem o dono das tabelas altera movimentação confirmada ou aplica lançamento inconsistente', async () => {
    const movement = await stockIn(5);
    const owner = migratorClient();
    await expect(owner.$executeRaw`UPDATE "stock_movements" SET "notes" = 'alterado' WHERE "id" = ${movement.id}::uuid`).rejects.toThrow(/SG_IMMUTABLE_MOVEMENT/u);
    await expect(owner.$executeRaw`DELETE FROM "audit_logs"`).rejects.toThrow(/SG_APPEND_ONLY/u);
  });

  it('toda movimentação fica auditada e a cadeia de auditoria permanece íntegra', async () => {
    const movement = await stockIn(5);
    const actions = await getPrisma().auditLog.findMany({ where: { entityId: movement.id }, select: { action: true } });
    expect(actions.map((entry) => entry.action)).toEqual(expect.arrayContaining(['movements.create', 'movements.confirm']));
    const verification = await verifyAuditChain();
    expect(verification.valid).toBe(true);
    expect(verification.checked).toBeGreaterThan(2);
  });
});
