import { randomUUID } from 'node:crypto';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { encryptSecret } from '../../src/auth/crypto.js';
import { hashPassword } from '../../src/auth/password.js';
import type { RoleCode } from '../../src/auth/permissions.js';
import { base32Decode, generateTotpSecret, hotp, totpStep } from '../../src/auth/totp.js';
import { getEnv } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createDatabase, disconnectPrisma, getPrisma, type Database } from '../../src/lib/prisma.js';
import { isTestDatabase } from './global-setup.js';
import { syncPermissionsAndRoles } from '../../src/services/bootstrap.service.js';
import { sessionCookieName } from '../../src/services/session.service.js';

export type TestApp = Awaited<ReturnType<typeof buildApp>>;
export const PASSWORD = 'Teste-Integracao#2026';

export async function buildTestApp(options: BuildAppOptions = {}): Promise<TestApp> {
  const app = await buildApp(options);
  await app.ready();
  return app;
}

let migrator: Database | undefined;

/** Cliente com o papel dono do schema — usado apenas para limpar o banco de teste. */
export function migratorClient(): PrismaClient {
  migrator ??= createDatabase(process.env.MIGRATION_DATABASE_URL!);
  return migrator.prisma;
}

export async function closeAll(app?: TestApp) {
  await app?.close();
  await disconnectPrisma();
  await migrator?.close();
  migrator = undefined;
}

const TABLES = [
  'alerts', 'discrepancy_evidences', 'discrepancy_actions', 'discrepancies', 'check_attempts',
  'inventory_count_items', 'inventory_counts', 'stock_ledger_entries', 'stock_balances',
  'stock_movement_items', 'stock_movements', 'lots', 'products', 'categories', 'locations',
  'sectors', 'warehouses', 'audit_logs', 'sessions', 'system_settings', 'role_permissions',
  'permissions', 'users', 'roles',
];

export async function resetDatabase() {
  if (!isTestDatabase()) {
    throw new Error('resetDatabase recusado: não é o banco de teste.');
  }
  // TRUNCATE não dispara os triggers de linha (append-only); só o dono das tabelas pode executá-lo.
  await migratorClient().$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await syncPermissionsAndRoles(getPrisma());
}

// ---------------------------------------------------------------------------
// Usuários e sessões
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: RoleCode;
  totpSecret?: string;
}

let userCounter = 0;

export async function createUser(role: RoleCode, options: { mfa?: boolean; mustChangePassword?: boolean; active?: boolean } = {}): Promise<TestUser> {
  userCounter += 1;
  const prisma = getPrisma();
  const env = getEnv();
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: role } });
  const mfa = options.mfa ?? env.MFA_REQUIRED_ROLES.includes(role);
  const totpSecret = mfa ? generateTotpSecret() : undefined;
  const name = `Usuário ${role} ${userCounter}`;
  const email = `${role.toLowerCase()}${userCounter}@teste.local`;

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(PASSWORD),
      roleId: roleRow.id,
      mustChangePassword: options.mustChangePassword ?? false,
      active: options.active ?? true,
      mfaEnabled: mfa,
      mfaSecretEnc: totpSecret ? encryptSecret(totpSecret, env.MFA_ENCRYPTION_KEY) : null,
    },
  });
  return { id: user.id, name, email, password: PASSWORD, role, ...(totpSecret ? { totpSecret } : {}) };
}

export function currentTotp(secret: string): string {
  return hotp(base32Decode(secret), totpStep());
}

export function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((entry) => entry.name === sessionCookieName());
  if (!cookie) throw new Error(`Resposta sem cookie de sessão (HTTP ${response.statusCode}): ${response.body}`);
  return cookie.value;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Cliente HTTP de teste: envia Origin autorizado e o cookie de sessão. */
export class ApiClient {
  constructor(private readonly app: TestApp, public token: string | null = null) {}

  request(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}, raw?: Buffer) {
    const options: InjectOptions = {
      method,
      url: `/api/v1${url}`,
      headers: { origin: getEnv().FRONTEND_ORIGIN, ...headers },
      ...(this.token ? { cookies: { [sessionCookieName()]: this.token } } : {}),
      ...(raw ? { payload: raw } : body === undefined ? {} : { payload: body as InjectOptions['payload'] }),
    };
    return this.app.inject(options);
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, undefined, headers);
  }

  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', url, body, headers);
  }

  patch(url: string, body?: unknown) {
    return this.request('PATCH', url, body);
  }

  put(url: string, body?: unknown) {
    return this.request('PUT', url, body);
  }
}

export async function login(app: TestApp, user: TestUser): Promise<ApiClient> {
  const response = await new ApiClient(app).post('/auth/login', { email: user.email, password: user.password });
  if (response.statusCode !== 200) throw new Error(`Login falhou (${response.statusCode}): ${response.body}`);
  const client = new ApiClient(app, sessionCookie(response));
  const pendingStep = response.json<{ pendingStep: string | null }>().pendingStep;

  if (pendingStep === 'MFA_VERIFY') {
    // Permite logins repetidos do mesmo usuário dentro da janela de 30s nos testes.
    await getPrisma().user.update({ where: { id: user.id }, data: { mfaLastUsedStep: null } });
    const verify = await client.post('/auth/mfa/verify', { code: currentTotp(user.totpSecret!) });
    if (verify.statusCode !== 200) throw new Error(`MFA falhou (${verify.statusCode}): ${verify.body}`);
    client.token = sessionCookie(verify);
  } else if (pendingStep) {
    throw new Error(`Etapa de autenticação inesperada: ${pendingStep}`);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Dados de apoio
// ---------------------------------------------------------------------------

export const idempotencyKey = () => randomUUID().replaceAll('-', '');

export async function createLayout() {
  const prisma = getPrisma();
  const warehouse = await prisma.warehouse.create({ data: { code: 'CD1', name: 'Centro de distribuição de teste' } });
  const sectorA = await prisma.sector.create({ data: { warehouseId: warehouse.id, code: 'A', name: 'Armazenagem' } });
  const sectorB = await prisma.sector.create({ data: { warehouseId: warehouse.id, code: 'B', name: 'Expedição' } });
  const location = (sectorId: string, sector: string, shelf: string) =>
    prisma.location.create({ data: { warehouseId: warehouse.id, sectorId, code: `${sector}-01-${shelf}-01`, aisle: '01', shelf, position: '01' } });
  const [a1, a2, b1] = await Promise.all([location(sectorA.id, 'A', '01'), location(sectorA.id, 'A', '02'), location(sectorB.id, 'B', '01')]);
  return { warehouse, sectorA, sectorB, a1, a2, b1 };
}

let productCounter = 0;

export async function createProduct(data: Partial<{ internalCode: string; barcode: string; name: string; unit: 'UN' | 'KG'; minStock: string; unitCost: string; tracksLot: boolean }> = {}) {
  productCounter += 1;
  return getPrisma().product.create({
    data: {
      internalCode: data.internalCode ?? `P${String(productCounter).padStart(5, '0')}`,
      barcode: data.barcode ?? `789${String(productCounter).padStart(10, '0')}`,
      name: data.name ?? `Produto de teste ${productCounter}`,
      unit: data.unit ?? 'UN',
      minStock: data.minStock ?? '0',
      unitCost: data.unitCost ?? '10.00',
      tracksLot: data.tracksLot ?? false,
    },
  });
}

interface MovementResponse {
  movement: { id: string; number: number; status: string; items: Array<{ id: string; productId: string }> };
  replayed: boolean;
}

/** Entrada completa (registro + conferência por outra pessoa), como na operação real. */
export async function receiveStock(
  operator: ApiClient,
  checker: ApiClient,
  input: { warehouseId: string; productId: string; productCode: string; locationId: string; locationCode: string; quantity: number },
) {
  const created = await operator.post(
    '/movements',
    { type: 'ENTRY', warehouseId: input.warehouseId, items: [{ productId: input.productId, toLocationId: input.locationId, quantity: input.quantity }] },
    { 'idempotency-key': idempotencyKey() },
  );
  if (created.statusCode !== 201) throw new Error(`Entrada recusada (${created.statusCode}): ${created.body}`);
  const { movement } = created.json<MovementResponse>();
  const confirmed = await checker.post(`/movements/${movement.id}/confirm`, {
    items: [{ itemId: movement.items[0]!.id, locationCode: input.locationCode, productCode: input.productCode, quantity: String(input.quantity) }],
  });
  if (confirmed.statusCode !== 200) throw new Error(`Conferência recusada (${confirmed.statusCode}): ${confirmed.body}`);
  return movement;
}

export async function balanceOf(productId: string, locationId: string): Promise<number> {
  const balance = await getPrisma().stockBalance.findFirst({ where: { productId, locationId }, select: { quantity: true } });
  return balance ? Number(balance.quantity) : 0;
}

export function multipartFile(fileName: string, content: Buffer, contentType: string) {
  const boundary = `----stockguard${randomUUID().replaceAll('-', '')}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, content, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export type { MovementResponse };
