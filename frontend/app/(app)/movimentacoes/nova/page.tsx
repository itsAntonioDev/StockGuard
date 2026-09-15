'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, Notice, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { usePermissions } from '@/hooks/use-session';
import { ApiError, newIdempotencyKey } from '@/lib/api';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { catalogService, locationService, movementService } from '@/services';
import type { LocationSummary, Lot, MovementCreateInput, ProductSummary } from '@/types/api';

type CreatableType = MovementCreateInput['type'];

interface ItemDraft {
  key: string;
  productCode: string;
  product: ProductSummary | null;
  productError: string | null;
  lots: Lot[];
  fromCode: string;
  from: LocationSummary | null;
  fromError: string | null;
  toCode: string;
  to: LocationSummary | null;
  toError: string | null;
  quantity: string;
  lotId: string;
  lotCode: string;
  lotExpiresAt: string;
  direction: 'IN' | 'OUT';
}

const emptyItem = (): ItemDraft => ({
  key: crypto.randomUUID(),
  productCode: '',
  product: null,
  productError: null,
  lots: [],
  fromCode: '',
  from: null,
  fromError: null,
  toCode: '',
  to: null,
  toError: null,
  quantity: '',
  lotId: '',
  lotCode: '',
  lotExpiresAt: '',
  direction: 'OUT',
});

const errorText = (error: unknown) => (error instanceof ApiError ? error.message : 'Não foi possível consultar.');

export default function NewMovementPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const types = useMemo(
    () => (Object.keys(MOVEMENT_TYPE) as Array<keyof typeof MOVEMENT_TYPE>).filter((type): type is CreatableType => type !== 'INVENTORY' && (type === 'ADJUSTMENT' ? can('movements.adjust.request') : can('movements.create'))),
    [can],
  );
  const [typeChoice, setType] = useState<CreatableType>('ENTRY');
  const [warehouseChoice, setWarehouseId] = useState('');
  const [header, setHeader] = useState({ referenceDoc: '', reason: '', notes: '' });
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const idempotencyKey = useRef(newIdempotencyKey());

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: locationService.warehouses });
  const activeWarehouses = (warehouses.data?.items ?? []).filter((warehouse) => warehouse.active);

  // Valores derivados (sem efeitos): o tipo precisa ser permitido ao perfil e o armazém padrão é o primeiro ativo.
  const type: CreatableType = types.includes(typeChoice) ? typeChoice : (types[0] ?? typeChoice);
  const warehouseId = warehouseChoice || activeWarehouses[0]?.id || '';

  const update = (key: string, patch: Partial<ItemDraft>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const needsFrom = (item: ItemDraft) => type === 'EXIT' || type === 'PICKING' || type === 'TRANSFER' || (type === 'ADJUSTMENT' && item.direction === 'OUT');
  const needsTo = (item: ItemDraft) => type === 'ENTRY' || type === 'TRANSFER' || (type === 'ADJUSTMENT' && item.direction === 'IN');
  const isIncomingLot = (item: ItemDraft) => type === 'ENTRY' || (type === 'ADJUSTMENT' && item.direction === 'IN');

  async function resolveProduct(item: ItemDraft) {
    if (!item.productCode.trim()) return update(item.key, { product: null, productError: null, lots: [] });
    try {
      const product = await catalogService.lookup(item.productCode.trim());
      const lots = product.tracksLot ? (await catalogService.lots(product.id)).items : [];
      update(item.key, { product, lots, productError: product.active ? null : 'Produto inativo.' });
    } catch (error) {
      update(item.key, { product: null, lots: [], productError: errorText(error) });
    }
  }

  async function resolveLocation(item: ItemDraft, field: 'from' | 'to') {
    const code = (field === 'from' ? item.fromCode : item.toCode).trim();
    if (!code) return update(item.key, { [field]: null, [`${field}Error`]: null } as Partial<ItemDraft>);
    try {
      const location = await locationService.lookup(code, warehouseId || undefined);
      const problem = location.status !== 'ACTIVE' ? `Endereço ${location.status === 'BLOCKED' ? 'bloqueado' : 'inativo'}.` : null;
      update(item.key, { [field]: location, [`${field}Error`]: problem } as Partial<ItemDraft>);
    } catch (error) {
      update(item.key, { [field]: null, [`${field}Error`]: errorText(error) } as Partial<ItemDraft>);
    }
  }

  const create = useMutation({
    mutationFn: () => {
      const input: MovementCreateInput = {
        type,
        warehouseId,
        ...(header.referenceDoc.trim() ? { referenceDoc: header.referenceDoc.trim() } : {}),
        ...(header.reason.trim() ? { reason: header.reason.trim() } : {}),
        ...(header.notes.trim() ? { notes: header.notes.trim() } : {}),
        items: items.map((item) => ({
          productId: item.product!.id,
          quantity: item.quantity.trim().replace(',', '.'),
          ...(needsFrom(item) && item.from ? { fromLocationId: item.from.id } : {}),
          ...(needsTo(item) && item.to ? { toLocationId: item.to.id } : {}),
          ...(type === 'ADJUSTMENT' ? { direction: item.direction } : {}),
          ...(item.product?.tracksLot && !isIncomingLot(item) && item.lotId ? { lotId: item.lotId } : {}),
          ...(item.product?.tracksLot && isIncomingLot(item) && item.lotCode.trim() ? { lotCode: item.lotCode.trim() } : {}),
          ...(item.product?.tracksLot && isIncomingLot(item) && item.lotExpiresAt ? { lotExpiresAt: item.lotExpiresAt } : {}),
        })),
      };
      return movementService.create(input, idempotencyKey.current);
    },
    onSuccess: (result) => {
      idempotencyKey.current = newIdempotencyKey();
      const warnings = result.warnings.length ? `?avisos=${encodeURIComponent(result.warnings.join(' | '))}` : '';
      router.push(`/movimentacoes/${result.movement.id}${warnings}`);
    },
  });

  const ready =
    Boolean(warehouseId) &&
    items.length > 0 &&
    items.every(
      (item) =>
        item.product &&
        !item.productError &&
        Number(item.quantity.replace(',', '.')) > 0 &&
        (!needsFrom(item) || (item.from && !item.fromError)) &&
        (!needsTo(item) || (item.to && !item.toError)),
    ) &&
    (type !== 'ADJUSTMENT' || header.reason.trim().length >= 10);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) create.mutate();
  }

  return (
    <>
      <PageHeader title="Nova movimentação" description="O estoque só é alterado após conferência (ou aprovação, no caso de ajustes)." />
      <form onSubmit={submit} className="space-y-6">
        <Card title="Dados da operação">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tipo de operação" required>
              {(id) => (
                <Select id={id} value={type} onChange={(event) => setType(event.target.value as CreatableType)}>
                  {types.map((value) => <option key={value} value={value}>{MOVEMENT_TYPE[value]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Armazém" required>
              {(id) => (
                <Select id={id} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                  {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Documento de referência" hint="Nota fiscal, pedido etc.">
              {(id) => <Input id={id} maxLength={60} value={header.referenceDoc} onChange={(event) => setHeader({ ...header, referenceDoc: event.target.value })} />}
            </Field>
            <Field label="Justificativa" required={type === 'ADJUSTMENT'} hint={type === 'ADJUSTMENT' ? 'Obrigatória (mín. 10 caracteres). O ajuste será aprovado por outra pessoa.' : undefined} className="sm:col-span-3">
              {(id) => <Textarea id={id} maxLength={500} value={header.reason} onChange={(event) => setHeader({ ...header, reason: event.target.value })} />}
            </Field>
            <Field label="Observações" className="sm:col-span-3">
              {(id) => <Input id={id} maxLength={1000} value={header.notes} onChange={(event) => setHeader({ ...header, notes: event.target.value })} />}
            </Field>
          </div>
        </Card>

        <Card
          title="Itens"
          description="Informe os códigos (leitor de código de barras ou digitação) e pressione Tab para validar."
          actions={<Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setItems((current) => [...current, emptyItem()])} disabled={items.length >= 200}>Adicionar item</Button>}
        >
          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={item.key} className="rounded-md border border-neutral-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">Item {index + 1}</p>
                  {items.length > 1 && (
                    <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>
                      Remover
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Produto (código)" required error={item.productError} hint={item.product ? `${item.product.name} · ${item.product.unit}` : undefined}>
                    {(id) => <Input id={id} value={item.productCode} onChange={(event) => update(item.key, { productCode: event.target.value, product: null })} onBlur={() => resolveProduct(item)} aria-invalid={Boolean(item.productError)} />}
                  </Field>
                  {type === 'ADJUSTMENT' && (
                    <Field label="Direção" required>
                      {(id) => (
                        <Select id={id} value={item.direction} onChange={(event) => update(item.key, { direction: event.target.value as 'IN' | 'OUT' })}>
                          <option value="OUT">Baixa (retira do endereço)</option>
                          <option value="IN">Acréscimo (adiciona ao endereço)</option>
                        </Select>
                      )}
                    </Field>
                  )}
                  {needsFrom(item) && (
                    <Field label="Endereço de origem" required error={item.fromError} hint={item.from ? `${item.from.sector.name}` : undefined}>
                      {(id) => <Input id={id} value={item.fromCode} placeholder="A-01-02-03" onChange={(event) => update(item.key, { fromCode: event.target.value, from: null })} onBlur={() => resolveLocation(item, 'from')} aria-invalid={Boolean(item.fromError)} />}
                    </Field>
                  )}
                  {needsTo(item) && (
                    <Field label="Endereço de destino" required error={item.toError} hint={item.to ? `${item.to.sector.name}` : undefined}>
                      {(id) => <Input id={id} value={item.toCode} placeholder="A-01-02-03" onChange={(event) => update(item.key, { toCode: event.target.value, to: null })} onBlur={() => resolveLocation(item, 'to')} aria-invalid={Boolean(item.toError)} />}
                    </Field>
                  )}
                  <Field label="Quantidade" required hint={item.product && ['UN', 'CX', 'PCT'].includes(item.product.unit) ? 'Somente números inteiros.' : undefined}>
                    {(id) => <Input id={id} inputMode="decimal" value={item.quantity} onChange={(event) => update(item.key, { quantity: event.target.value })} />}
                  </Field>
                  {item.product?.tracksLot && isIncomingLot(item) && (
                    <>
                      <Field label="Lote" required>{(id) => <Input id={id} maxLength={60} value={item.lotCode} onChange={(event) => update(item.key, { lotCode: event.target.value })} />}</Field>
                      {item.product.tracksExpiry && (
                        <Field label="Validade" hint="Obrigatória para lotes novos.">{(id) => <Input id={id} type="date" value={item.lotExpiresAt} onChange={(event) => update(item.key, { lotExpiresAt: event.target.value })} />}</Field>
                      )}
                    </>
                  )}
                  {item.product?.tracksLot && !isIncomingLot(item) && (
                    <Field label="Lote" required>
                      {(id) => (
                        <Select id={id} value={item.lotId} onChange={(event) => update(item.key, { lotId: event.target.value })}>
                          <option value="">Selecione</option>
                          {item.lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.code}</option>)}
                        </Select>
                      )}
                    </Field>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {create.error && <ErrorMessage error={create.error} title="A movimentação não foi registrada" />}
        {type === 'ADJUSTMENT' && <Notice tone="info">Ajustes não alteram o estoque até serem aprovados por outra pessoa com permissão.</Notice>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          <Button type="submit" size="lg" loading={create.isPending} disabled={!ready}>Registrar movimentação</Button>
        </div>
      </form>
    </>
  );
}
