'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { ApiError } from '@/lib/api';
import { DISCREPANCY_TYPE } from '@/lib/labels';
import { catalogService, discrepancyService, locationService } from '@/services';
import type { DiscrepancyType, LocationSummary, ProductSummary } from '@/types/api';

function NewDiscrepancyForm() {
  const router = useRouter();
  const movementItemId = useSearchParams().get('movementItemId');
  const [type, setType] = useState<DiscrepancyType>('QUANTITY_MISMATCH');
  const [productCode, setProductCode] = useState('');
  const [product, setProduct] = useState<{ value: ProductSummary | null; error: string | null }>({ value: null, error: null });
  const [locationCode, setLocationCode] = useState('');
  const [location, setLocation] = useState<{ value: LocationSummary | null; error: string | null }>({ value: null, error: null });
  const [form, setForm] = useState({ expectedQuantity: '', foundQuantity: '', expectedCode: '', foundCode: '', description: '' });

  async function resolveProduct() {
    if (!productCode.trim()) return setProduct({ value: null, error: null });
    try {
      setProduct({ value: await catalogService.lookup(productCode.trim()), error: null });
    } catch (error) {
      setProduct({ value: null, error: error instanceof ApiError ? error.message : 'Produto não encontrado.' });
    }
  }

  async function resolveLocation() {
    if (!locationCode.trim()) return setLocation({ value: null, error: null });
    try {
      setLocation({ value: await locationService.lookup(locationCode.trim()), error: null });
    } catch (error) {
      setLocation({ value: null, error: error instanceof ApiError ? error.message : 'Endereço não encontrado.' });
    }
  }

  const create = useMutation({
    mutationFn: () =>
      discrepancyService.create({
        type,
        description: form.description.trim(),
        ...(movementItemId ? { movementItemId } : {}),
        ...(product.value ? { productId: product.value.id } : {}),
        ...(location.value ? { locationId: location.value.id } : {}),
        ...(form.expectedQuantity ? { expectedQuantity: form.expectedQuantity.replace(',', '.') } : {}),
        ...(form.foundQuantity ? { foundQuantity: form.foundQuantity.replace(',', '.') } : {}),
        ...(form.expectedCode.trim() ? { expectedCode: form.expectedCode.trim() } : {}),
        ...(form.foundCode.trim() ? { foundCode: form.foundCode.trim() } : {}),
      }),
    onSuccess: (discrepancy) => router.push(`/divergencias/${discrepancy.id}`),
  });

  const ready =
    form.description.trim().length >= 10 &&
    (movementItemId || product.value || location.value) &&
    (type !== 'QUANTITY_MISMATCH' || (form.expectedQuantity !== '' && form.foundQuantity !== ''));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) create.mutate();
  }

  return (
    <>
      <PageHeader title="Registrar divergência" description="Descreva o que foi encontrado. A causa será definida na análise." />
      <form onSubmit={submit}>
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {movementItemId && <div className="sm:col-span-2"><Notice tone="info">Vinculada ao item da movimentação: produto, lote e endereço serão preenchidos a partir da operação.</Notice></div>}
            <Field label="Tipo de divergência" required>
              {(id) => (
                <Select id={id} value={type} onChange={(event) => setType(event.target.value as DiscrepancyType)}>
                  {(Object.keys(DISCREPANCY_TYPE) as DiscrepancyType[]).map((value) => <option key={value} value={value}>{DISCREPANCY_TYPE[value]}</option>)}
                </Select>
              )}
            </Field>
            <div />
            <Field label="Produto (código)" error={product.error} hint={product.value?.name}>
              {(id) => <Input id={id} value={productCode} onChange={(event) => setProductCode(event.target.value)} onBlur={resolveProduct} />}
            </Field>
            <Field label="Endereço (código)" error={location.error} hint={location.value ? `${location.value.warehouse.code} · ${location.value.sector.name}` : undefined}>
              {(id) => <Input id={id} value={locationCode} placeholder="A-01-02-03" onChange={(event) => setLocationCode(event.target.value)} onBlur={resolveLocation} />}
            </Field>
            <Field label="Quantidade esperada" required={type === 'QUANTITY_MISMATCH'}>
              {(id) => <Input id={id} inputMode="decimal" value={form.expectedQuantity} onChange={(event) => setForm({ ...form, expectedQuantity: event.target.value })} />}
            </Field>
            <Field label="Quantidade encontrada" required={type === 'QUANTITY_MISMATCH'}>
              {(id) => <Input id={id} inputMode="decimal" value={form.foundQuantity} onChange={(event) => setForm({ ...form, foundQuantity: event.target.value })} />}
            </Field>
            <Field label="Código esperado" hint="Ex.: produto ou lote que deveria estar no endereço">
              {(id) => <Input id={id} maxLength={64} value={form.expectedCode} onChange={(event) => setForm({ ...form, expectedCode: event.target.value })} />}
            </Field>
            <Field label="Código encontrado">
              {(id) => <Input id={id} maxLength={64} value={form.foundCode} onChange={(event) => setForm({ ...form, foundCode: event.target.value })} />}
            </Field>
            <Field label="Descrição" required hint="Mínimo de 10 caracteres. Descreva fatos, sem apontar culpados." className="sm:col-span-2">
              {(id) => <Textarea id={id} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}
            </Field>
            {create.error && <div className="sm:col-span-2"><ErrorMessage error={create.error} /></div>}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
            <Button type="submit" loading={create.isPending} disabled={!ready}>Registrar</Button>
          </div>
        </Card>
      </form>
    </>
  );
}

export default function NewDiscrepancyPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewDiscrepancyForm />
    </Suspense>
  );
}
