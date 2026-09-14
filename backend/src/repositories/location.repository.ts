import { BusinessRuleError } from '../lib/errors.js';
import type { DbClient } from '../lib/prisma.js';

export const locationSummarySelect = {
  id: true,
  code: true,
  aisle: true,
  shelf: true,
  position: true,
  capacity: true,
  status: true,
  warehouse: { select: { id: true, code: true, name: true } },
  sector: { select: { id: true, code: true, name: true } },
} as const;

export function buildLocationCode(sectorCode: string, aisle: string, shelf: string, position: string): string {
  return [sectorCode, aisle, shelf, position].map((part) => part.trim().toUpperCase()).join('-');
}

export function findLocationByCode(db: DbClient, code: string, warehouseId?: string) {
  return db.location.findFirst({
    where: { code: code.trim().toUpperCase(), ...(warehouseId ? { warehouseId } : {}) },
    select: { ...locationSummarySelect, warehouseId: true, sectorId: true },
  });
}

export interface LocationScope {
  id: string;
  code: string;
  warehouseId: string;
  sectorId: string;
}

/**
 * Endereços em inventário aberto ficam congelados: movimentá-los durante a
 * contagem geraria diferenças falsas.
 */
export async function assertLocationsNotUnderInventory(db: DbClient, locations: LocationScope[], ignoreInventoryId?: string) {
  if (locations.length === 0) return;
  const warehouseIds = [...new Set(locations.map((location) => location.warehouseId))];
  const open = await db.inventoryCount.findMany({
    where: {
      warehouseId: { in: warehouseIds },
      status: { in: ['OPEN', 'SUBMITTED'] },
      ...(ignoreInventoryId ? { id: { not: ignoreInventoryId } } : {}),
    },
    select: { number: true, warehouseId: true, sectorId: true },
  });
  for (const location of locations) {
    const blocking = open.find(
      (inventory) => inventory.warehouseId === location.warehouseId && (inventory.sectorId === null || inventory.sectorId === location.sectorId),
    );
    if (blocking) {
      throw new BusinessRuleError(
        'LOCATION_UNDER_INVENTORY',
        `O endereço ${location.code} está em inventário (#${blocking.number}). Aguarde a conclusão da contagem.`,
      );
    }
  }
}
