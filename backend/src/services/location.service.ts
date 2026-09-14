import { BusinessRuleError, ConflictError, NotFoundError } from '../lib/errors.js';
import { getPrisma, Prisma } from '../lib/prisma.js';
import { buildLocationCode } from '../repositories/location.repository.js';
import { diffFields } from '../utils/diff.js';
import { toNumber } from '../utils/quantity.js';
import type { RequestContext } from '../utils/request-context.js';
import { skipTake, toPage } from '../validators/common.js';
import type {
  LocationBulkCreateInput,
  LocationCreateInput,
  LocationListQuery,
  LocationLookupQuery,
  LocationUpdateInput,
  SectorCreateInput,
  SectorUpdateInput,
  WarehouseCreateInput,
  WarehouseUpdateInput,
} from '../validators/location.schemas.js';
import { writeAudit } from './audit.service.js';

const locationSelect = {
  id: true,
  code: true,
  aisle: true,
  shelf: true,
  position: true,
  capacity: true,
  status: true,
  updatedAt: true,
  warehouse: { select: { id: true, code: true, name: true } },
  sector: { select: { id: true, code: true, name: true } },
} satisfies Prisma.LocationSelect;

type LocationRow = Prisma.LocationGetPayload<{ select: typeof locationSelect }>;

function presentLocation(location: LocationRow) {
  return { ...location, capacity: toNumber(location.capacity) };
}

// ---------------------------------------------------------------------------
// Armazéns
// ---------------------------------------------------------------------------

export async function listWarehouses() {
  return getPrisma().warehouse.findMany({
    orderBy: { code: 'asc' },
    include: { _count: { select: { sectors: true, locations: true } } },
  });
}

export async function createWarehouse(input: WarehouseCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.warehouse.findUnique({ where: { code: input.code }, select: { id: true } });
    if (duplicate) throw new ConflictError('Já existe um armazém com este código.', 'WAREHOUSE_DUPLICATE');
    const warehouse = await tx.warehouse.create({ data: input });
    await writeAudit(tx, context, { action: 'warehouses.create', result: 'SUCCESS', entityType: 'Warehouse', entityId: warehouse.id, metadata: { after: input } });
    return warehouse;
  });
}

export async function updateWarehouse(warehouseId: string, input: WarehouseUpdateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.warehouse.findUnique({ where: { id: warehouseId } });
    if (!current) throw new NotFoundError('Armazém não encontrado.');
    if (input.active === false) {
      const balance = await tx.stockBalance.findFirst({ where: { quantity: { gt: 0 }, location: { warehouseId } }, select: { id: true } });
      if (balance) throw new BusinessRuleError('WAREHOUSE_HAS_STOCK', 'Não é possível inativar um armazém com saldo em estoque.');
    }
    const changes = diffFields(current as unknown as Record<string, unknown>, input);
    const warehouse = await tx.warehouse.update({ where: { id: warehouseId }, data: input });
    await writeAudit(tx, context, { action: 'warehouses.update', result: 'SUCCESS', entityType: 'Warehouse', entityId: warehouseId, metadata: { changes } });
    return warehouse;
  });
}

// ---------------------------------------------------------------------------
// Setores
// ---------------------------------------------------------------------------

export async function listSectors(warehouseId?: string) {
  return getPrisma().sector.findMany({
    where: warehouseId ? { warehouseId } : {},
    orderBy: [{ warehouse: { code: 'asc' } }, { code: 'asc' }],
    include: { warehouse: { select: { id: true, code: true, name: true } }, _count: { select: { locations: true } } },
  });
}

export async function createSector(input: SectorCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { active: true } });
    if (!warehouse) throw new BusinessRuleError('WAREHOUSE_NOT_FOUND', 'Armazém não encontrado.');
    if (!warehouse.active) throw new BusinessRuleError('WAREHOUSE_INACTIVE', 'O armazém está inativo.');

    const duplicate = await tx.sector.findUnique({ where: { warehouseId_code: { warehouseId: input.warehouseId, code: input.code } }, select: { id: true } });
    if (duplicate) throw new ConflictError('Já existe um setor com este código no armazém.', 'SECTOR_DUPLICATE');

    const sector = await tx.sector.create({ data: input });
    await writeAudit(tx, context, { action: 'sectors.create', result: 'SUCCESS', entityType: 'Sector', entityId: sector.id, metadata: { after: input } });
    return sector;
  });
}

export async function updateSector(sectorId: string, input: SectorUpdateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.sector.findUnique({ where: { id: sectorId } });
    if (!current) throw new NotFoundError('Setor não encontrado.');
    if (input.active === false) {
      const balance = await tx.stockBalance.findFirst({ where: { quantity: { gt: 0 }, location: { sectorId } }, select: { id: true } });
      if (balance) throw new BusinessRuleError('SECTOR_HAS_STOCK', 'Não é possível inativar um setor com saldo em estoque.');
    }
    const changes = diffFields(current as unknown as Record<string, unknown>, input);
    const sector = await tx.sector.update({ where: { id: sectorId }, data: input });
    await writeAudit(tx, context, { action: 'sectors.update', result: 'SUCCESS', entityType: 'Sector', entityId: sectorId, metadata: { changes } });
    return sector;
  });
}

// ---------------------------------------------------------------------------
// Endereços
// ---------------------------------------------------------------------------

export async function listLocations(query: LocationListQuery) {
  const prisma = getPrisma();
  const where: Prisma.LocationWhereInput = {
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { code: { contains: query.search.toUpperCase() } } : {}),
  };
  const [total, locations] = await Promise.all([
    prisma.location.count({ where }),
    prisma.location.findMany({ where, select: locationSelect, orderBy: { code: 'asc' }, ...skipTake(query.page, query.pageSize) }),
  ]);
  return toPage(locations.map(presentLocation), total, query.page, query.pageSize);
}

/** Endereço com os produtos armazenados nele. */
export async function getLocation(locationId: string) {
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: locationSelect });
  if (!location) throw new NotFoundError('Endereço não encontrado.');

  const balances = await prisma.stockBalance.findMany({
    where: { locationId, quantity: { gt: 0 } },
    orderBy: { product: { name: 'asc' } },
    select: {
      quantity: true,
      updatedAt: true,
      product: { select: { id: true, internalCode: true, barcode: true, name: true, unit: true } },
      lot: { select: { id: true, code: true, expiresAt: true } },
    },
  });
  const occupied = balances.reduce((sum, balance) => sum.plus(balance.quantity), new Prisma.Decimal(0));

  return {
    ...presentLocation(location),
    occupiedQuantity: toNumber(occupied)!,
    contents: balances.map((balance) => ({ ...balance, quantity: toNumber(balance.quantity)! })),
  };
}

/** Identificação por leitura de etiqueta do endereço (conferência). */
export async function lookupLocation(query: LocationLookupQuery) {
  const code = query.code.trim().toUpperCase();
  const matches = await getPrisma().location.findMany({
    where: { code, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
    select: locationSelect,
    take: 2,
  });
  if (matches.length === 0) throw new NotFoundError(`Endereço "${code.slice(0, 40)}" não encontrado.`);
  if (matches.length > 1) {
    throw new BusinessRuleError('LOCATION_AMBIGUOUS', 'Este código existe em mais de um armazém. Informe o armazém.');
  }
  return presentLocation(matches[0]!);
}

export async function createLocation(input: LocationCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const sector = await tx.sector.findUnique({
      where: { id: input.sectorId },
      select: { id: true, code: true, active: true, warehouseId: true, warehouse: { select: { active: true } } },
    });
    if (!sector) throw new BusinessRuleError('SECTOR_NOT_FOUND', 'Setor não encontrado.');
    if (!sector.active || !sector.warehouse.active) throw new BusinessRuleError('SECTOR_INACTIVE', 'O setor ou o armazém está inativo.');

    const code = buildLocationCode(sector.code, input.aisle, input.shelf, input.position);
    const duplicate = await tx.location.findUnique({ where: { warehouseId_code: { warehouseId: sector.warehouseId, code } }, select: { id: true } });
    if (duplicate) throw new ConflictError(`O endereço ${code} já existe neste armazém.`, 'LOCATION_DUPLICATE');

    const location = await tx.location.create({
      data: {
        warehouseId: sector.warehouseId,
        sectorId: sector.id,
        code,
        aisle: input.aisle,
        shelf: input.shelf,
        position: input.position,
        capacity: input.capacity ?? null,
      },
      select: locationSelect,
    });
    await writeAudit(tx, context, { action: 'locations.create', result: 'SUCCESS', entityType: 'Location', entityId: location.id, metadata: { code } });
    return presentLocation(location);
  });
}

export async function updateLocation(locationId: string, input: LocationUpdateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.location.findUnique({ where: { id: locationId } });
    if (!current) throw new NotFoundError('Endereço não encontrado.');

    if (input.status === 'INACTIVE' && current.status !== 'INACTIVE') {
      const balance = await tx.stockBalance.findFirst({ where: { locationId, quantity: { gt: 0 } }, select: { id: true } });
      if (balance) throw new BusinessRuleError('LOCATION_HAS_STOCK', 'Transfira o saldo antes de inativar o endereço.');
    }

    const changes = diffFields(current as unknown as Record<string, unknown>, input as Record<string, unknown>);
    const location = await tx.location.update({ where: { id: locationId }, data: input, select: locationSelect });
    await writeAudit(tx, context, { action: 'locations.update', result: 'SUCCESS', entityType: 'Location', entityId: locationId, metadata: { code: current.code, changes } });
    return presentLocation(location);
  });
}

/** Gera a grade de endereços de um setor; códigos já existentes são ignorados (e informados). */
export async function bulkCreateLocations(input: LocationBulkCreateInput, context: RequestContext) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const sector = await tx.sector.findUnique({
      where: { id: input.sectorId },
      select: { id: true, code: true, active: true, warehouseId: true, warehouse: { select: { active: true } } },
    });
    if (!sector) throw new BusinessRuleError('SECTOR_NOT_FOUND', 'Setor não encontrado.');
    if (!sector.active || !sector.warehouse.active) throw new BusinessRuleError('SECTOR_INACTIVE', 'O setor ou o armazém está inativo.');

    const pad = (value: number) => String(value).padStart(2, '0');
    const planned: Array<{ code: string; aisle: string; shelf: string; position: string }> = [];
    for (const aisle of new Set(input.aisles)) {
      for (let shelf = input.shelfFrom; shelf <= input.shelfTo; shelf += 1) {
        for (let position = input.positionFrom; position <= input.positionTo; position += 1) {
          planned.push({ code: buildLocationCode(sector.code, aisle, pad(shelf), pad(position)), aisle, shelf: pad(shelf), position: pad(position) });
        }
      }
    }

    const existing = await tx.location.findMany({
      where: { warehouseId: sector.warehouseId, code: { in: planned.map((item) => item.code) } },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((item) => item.code));
    const toCreate = planned.filter((item) => !existingCodes.has(item.code));

    if (toCreate.length > 0) {
      await tx.location.createMany({
        data: toCreate.map((item) => ({
          warehouseId: sector.warehouseId,
          sectorId: sector.id,
          code: item.code,
          aisle: item.aisle,
          shelf: item.shelf,
          position: item.position,
          capacity: input.capacity ?? null,
        })),
      });
    }
    await writeAudit(tx, context, {
      action: 'locations.bulk_create',
      result: 'SUCCESS',
      entityType: 'Sector',
      entityId: sector.id,
      metadata: { created: toCreate.length, skipped: existingCodes.size, first: toCreate[0]?.code ?? null, last: toCreate.at(-1)?.code ?? null },
    });
    return { created: toCreate.length, skippedCodes: [...existingCodes].sort() };
  });
}
