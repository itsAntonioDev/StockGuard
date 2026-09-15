import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { Prisma } from '../../src/lib/prisma.js';
import { discrepancyStatusChangeSchema } from '../../src/validators/discrepancy.schemas.js';
import { estimateDiscrepancyValue } from '../../src/repositories/discrepancy.repository.js';
import { discrepancyRate, percentChange, previousPeriod, resolvePeriod } from '../../src/services/analytics-period.js';
import { compareScan, type ExpectedItem } from '../../src/services/check.service.js';
import { validateStatusTransition } from '../../src/services/discrepancy.service.js';
import { classifyInventoryDifference } from '../../src/services/inventory.service.js';
import { buildDeltas } from '../../src/services/movement.service.js';
import { buildTrainingSuggestions } from '../../src/services/productivity.service.js';
import { isQuantityCompatibleWithUnit, nonNegativeQuantitySchema, positiveQuantitySchema } from '../../src/utils/quantity.js';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('quantidades', () => {
  it.each(['10', 10, '0.5', '1,25', '99999999999.999'])('aceita %s', (value) => {
    expect(positiveQuantitySchema.safeParse(value).success).toBe(true);
  });

  it.each(['0', 0, '-1', -1, '1.2345', 'abc', '1e3', '', '100000000000'])('recusa %s', (value) => {
    expect(positiveQuantitySchema.safeParse(value).success).toBe(false);
  });

  it('contagem aceita zero', () => {
    expect(nonNegativeQuantitySchema.parse('0')).toBe('0');
  });

  it('unidades inteiras não aceitam fração', () => {
    expect(isQuantityCompatibleWithUnit('1.5', 'UN')).toBe(false);
    expect(isQuantityCompatibleWithUnit('2', 'CX')).toBe(true);
    expect(isQuantityCompatibleWithUnit('1.5', 'KG')).toBe(true);
  });
});

describe('conferência — comparação esperado × informado', () => {
  const expected: ExpectedItem = {
    locationCode: 'A-01-02-03',
    destinationCode: null,
    productInternalCode: '12345',
    productBarcode: '7891000100103',
    productName: 'Café em pó 500 g',
    unit: 'UN',
    lotCode: null,
    tracksLot: false,
    quantity: '10',
  };
  const scan = { itemId: '00000000-0000-4000-8000-000000000001', locationCode: 'A-01-02-03', productCode: '7891000100103', quantity: '10' };

  it('tudo correto (código de barras, endereço sem diferenciar maiúsculas)', () => {
    expect(compareScan(expected, { ...scan, locationCode: 'a-01-02-03' }, null)).toEqual([]);
  });

  it('produto incorreto informa esperado e informado', () => {
    const [error] = compareScan(expected, { ...scan, productCode: '67890' }, { internalCode: '67890', name: 'Açúcar' });
    expect(error?.code).toBe('WRONG_PRODUCT');
    expect(error?.message).toContain('Produto esperado: Código 12345');
    expect(error?.message).toContain('Produto informado: Código 67890');
    expect(error?.message).toContain('Verifique o endereço');
  });

  it('código não cadastrado', () => {
    expect(compareScan(expected, { ...scan, productCode: '000' }, null)[0]?.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('endereço e quantidade incorretos são apontados juntos', () => {
    const codes = compareScan(expected, { ...scan, locationCode: 'A-01-02-04', quantity: '9' }, null).map((error) => error.code);
    expect(codes).toEqual(['WRONG_LOCATION', 'QUANTITY_MISMATCH']);
  });

  it('fração em unidade inteira', () => {
    expect(compareScan(expected, { ...scan, quantity: '9.5' }, null)[0]?.code).toBe('INVALID_QUANTITY_FOR_UNIT');
  });

  it('lote obrigatório e lote incorreto', () => {
    const withLot = { ...expected, tracksLot: true, lotCode: 'L2026A' };
    expect(compareScan(withLot, scan, null)[0]?.code).toBe('LOT_REQUIRED');
    expect(compareScan(withLot, { ...scan, lotCode: 'L2026B' }, null)[0]?.code).toBe('WRONG_LOT');
    expect(compareScan(withLot, { ...scan, lotCode: 'l2026a' }, null)).toEqual([]);
  });
});

describe('lançamentos de estoque por tipo', () => {
  const item = { id: 'i1', productId: 'p1', lotId: null, fromLocationId: 'l1', toLocationId: 'l2', direction: 1 };
  const quantities = new Map([['i1', D(3)]]);

  it('transferência gera saída na origem e entrada no destino', () => {
    const deltas = buildDeltas({ type: 'TRANSFER', items: [item] }, quantities);
    expect(deltas.map((delta) => [delta.locationId, delta.delta.toString()])).toEqual([['l1', '-3'], ['l2', '3']]);
  });

  it('entrada, saída e ajuste respeitam a direção', () => {
    expect(buildDeltas({ type: 'ENTRY', items: [{ ...item, fromLocationId: null }] }, quantities)[0]?.delta.toString()).toBe('3');
    expect(buildDeltas({ type: 'EXIT', items: [{ ...item, toLocationId: null }] }, quantities)[0]?.delta.toString()).toBe('-3');
    expect(buildDeltas({ type: 'ADJUSTMENT', items: [{ ...item, toLocationId: null, direction: -1 }] }, quantities)[0]?.delta.toString()).toBe('-3');
  });
});

describe('divergências', () => {
  const open = { status: 'OPEN' as const, correctiveAction: null, probableCause: 'NOT_DETERMINED' as const };
  const analysis = { ...open, status: 'IN_ANALYSIS' as const };

  // Entradas passam pelo mesmo schema usado na rota.
  const change = (input: z.input<typeof discrepancyStatusChangeSchema>) => discrepancyStatusChangeSchema.parse(input);

  it('segue o fluxo de status permitido', () => {
    expect(validateStatusTransition(open, change({ status: 'IN_ANALYSIS' }))).toEqual([]);
    expect(validateStatusTransition(open, change({ status: 'CORRECTED' }))).not.toEqual([]);
  });

  it('corrigir exige causa provável e ação corretiva definidas na análise', () => {
    expect(validateStatusTransition(analysis, change({ status: 'CORRECTED' }))).toHaveLength(2);
    expect(
      validateStatusTransition(analysis, change({ status: 'CORRECTED', probableCause: 'LABELING', correctiveAction: 'Etiquetas refeitas no corredor A.' })),
    ).toEqual([]);
  });

  it('descarte exige motivo e status final é imutável', () => {
    expect(validateStatusTransition(analysis, change({ status: 'DISCARDED' }))).not.toEqual([]);
    expect(validateStatusTransition({ ...analysis, status: 'CONFIRMED' }, change({ status: 'IN_ANALYSIS' }))).not.toEqual([]);
  });

  it('valor estimado não é inventado sem custo', () => {
    expect(estimateDiscrepancyValue('10', '7', D('2.5'))?.toString()).toBe('7.5');
    expect(estimateDiscrepancyValue('10', '7', null)).toBeNull();
  });

  it('classifica diferenças de inventário', () => {
    expect(classifyInventoryDifference(D(5), D(5))).toBeNull();
    expect(classifyInventoryDifference(D(5), D(0))).toBe('PRODUCT_NOT_FOUND');
    expect(classifyInventoryDifference(D(0), D(3))).toBe('WRONG_LOCATION');
    expect(classifyInventoryDifference(D(5), D(4))).toBe('QUANTITY_MISMATCH');
  });
});

describe('indicadores', () => {
  it('taxa de divergência segue a fórmula documentada e não inventa 0%', () => {
    expect(discrepancyRate(18, 1248)).toBe(1.44);
    expect(discrepancyRate(0, 0)).toBeNull();
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(5, 0)).toBeNull();
  });

  it('valida o período e calcula o período anterior de mesma duração', () => {
    const period = resolvePeriod(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-11T00:00:00Z'));
    expect(previousPeriod(period).from.toISOString()).toBe('2026-08-22T00:00:00.000Z');
    expect(() => resolvePeriod(new Date('2026-09-11'), new Date('2026-09-01'))).toThrow();
    expect(() => resolvePeriod(new Date('2024-01-01'), new Date('2026-01-01'))).toThrow();
  });

  it('sugestões de treinamento exigem amostra mínima e falam de processo', () => {
    expect(buildTrainingSuggestions({ WRONG_LOCATION: 8 }, 10, 20)).toEqual([]);
    const suggestions = buildTrainingSuggestions({ WRONG_LOCATION: 6, QUANTITY_MISMATCH: 4 }, 40, 20);
    expect(suggestions.map((suggestion) => suggestion.codes[0])).toEqual(['WRONG_LOCATION', 'QUANTITY_MISMATCH']);
    expect(suggestions[0]?.message).toMatch(/sinalização|procedimento/u);
  });
});
