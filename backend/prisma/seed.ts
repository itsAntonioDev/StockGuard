/**
 * Seed do StockGuard.
 *
 *   npm run db:seed                              perfis, permissões e administrador inicial
 *   npm run db:seed -- --reset-role-permissions  restaura as permissões padrão dos perfis
 *   npm run db:seed -- --demo                    + catálogo de DEMONSTRAÇÃO (somente desenvolvimento)
 *
 * Nunca imprime senhas. Dados de demonstração são identificados como tal e não
 * geram saldo: estoque só nasce de movimentações registradas.
 */
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { ensureInitialAdmin, syncPermissionsAndRoles } from '../src/services/bootstrap.service.js';

const args = new Set(process.argv.slice(2));
const prisma = getPrisma();

async function seedDemoCatalog() {
  if (process.env.NODE_ENV === 'production') throw new Error('Dados de demonstração não podem ser criados em produção.');

  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'DEMO' },
    create: { code: 'DEMO', name: '[DEMONSTRAÇÃO] Armazém de testes' },
    update: {},
  });

  for (const [code, name] of [['A', '[DEMO] Armazenagem'], ['B', '[DEMO] Expedição']] as const) {
    const sector = await prisma.sector.upsert({
      where: { warehouseId_code: { warehouseId: warehouse.id, code } },
      create: { warehouseId: warehouse.id, code, name },
      update: {},
    });
    const locations = [];
    for (const aisle of ['01', '02']) {
      for (const shelf of ['01', '02', '03']) {
        for (const position of ['01', '02']) {
          locations.push({ warehouseId: warehouse.id, sectorId: sector.id, code: `${code}-${aisle}-${shelf}-${position}`, aisle, shelf, position });
        }
      }
    }
    await prisma.location.createMany({ data: locations, skipDuplicates: true });
  }

  const category = await prisma.category.upsert({ where: { name: '[DEMO] Demonstração' }, create: { name: '[DEMO] Demonstração' }, update: {} });
  const products = [
    { internalCode: 'DEMO-0001', barcode: 'DEMO-BC-0001', name: '[DEMO] Café em pó 500 g', unit: 'UN' as const, minStock: '20', unitCost: '18.90' },
    { internalCode: 'DEMO-0002', barcode: 'DEMO-BC-0002', name: '[DEMO] Açúcar 1 kg', unit: 'UN' as const, minStock: '15', unitCost: '5.49' },
    { internalCode: 'DEMO-0003', barcode: 'DEMO-BC-0003', name: '[DEMO] Detergente 500 ml', unit: 'UN' as const, minStock: '30', unitCost: '2.79' },
    { internalCode: 'DEMO-0004', barcode: 'DEMO-BC-0004', name: '[DEMO] Farinha a granel', unit: 'KG' as const, minStock: '50', unitCost: '4.20' },
    { internalCode: 'DEMO-0005', barcode: 'DEMO-BC-0005', name: '[DEMO] Iogurte com lote', unit: 'UN' as const, minStock: '10', unitCost: '3.10', tracksLot: true, tracksExpiry: true, handlingClass: 'PERISHABLE' as const },
  ];
  for (const product of products) {
    await prisma.product.upsert({
      where: { internalCode: product.internalCode },
      create: { ...product, categoryId: category.id },
      update: {},
    });
  }
}

try {
  const roles = await syncPermissionsAndRoles(prisma, { resetRolePermissions: args.has('--reset-role-permissions') });
  console.table(roles);

  const { SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
  if (SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD) {
    const result = await ensureInitialAdmin(prisma, { name: SEED_ADMIN_NAME || 'Administrador', email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD });
    console.log(
      result === 'created'
        ? `Administrador inicial criado (${SEED_ADMIN_EMAIL}). No primeiro acesso serão exigidos MFA e troca de senha.`
        : 'Já existe administrador cadastrado — nenhum usuário foi criado.',
    );
    console.log('Recomendado: remova SEED_ADMIN_PASSWORD do .env.');
  } else {
    console.warn('SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD não definidos: administrador inicial não foi criado.');
  }

  if (args.has('--demo')) {
    await seedDemoCatalog();
    console.log('Catálogo de DEMONSTRAÇÃO criado (armazém DEMO, produtos DEMO-*). Sem saldo inicial.');
  }
} finally {
  await disconnectPrisma();
}
