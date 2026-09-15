'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { HANDLING_CLASS, UNIT } from '@/lib/labels';
import { catalogService } from '@/services';
import type { HandlingClass, ProductDetail, ProductSummary, Unit } from '@/types/api';

interface Props {
  open: boolean;
  product?: ProductDetail;
  onClose: () => void;
  onSaved: (product: ProductSummary) => void;
}

export function ProductFormModal({ open, product, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(product);
  const [form, setForm] = useState({
    internalCode: product?.internalCode ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    categoryId: product?.category?.id ?? '',
    unit: (product?.unit ?? 'UN') as Unit,
    minStock: product ? String(product.minStock) : '0',
    unitCost: product?.unitCost != null ? String(product.unitCost) : '',
    tracksLot: product?.tracksLot ?? false,
    tracksExpiry: product?.tracksExpiry ?? false,
    handlingClass: (product?.handlingClass ?? 'STANDARD') as HandlingClass,
    active: product?.active ?? true,
  });
  const [newCategory, setNewCategory] = useState('');
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => catalogService.categories(), enabled: open });

  const createCategory = useMutation({
    mutationFn: () => catalogService.createCategory({ name: newCategory.trim() }),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      set('categoryId', category.id);
      setNewCategory('');
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: form.name,
        unit: form.unit,
        minStock: form.minStock || '0',
        tracksLot: form.tracksLot,
        tracksExpiry: form.tracksLot && form.tracksExpiry,
        handlingClass: form.handlingClass,
      };
      if (editing && product) {
        return catalogService.updateProduct(product.id, {
          ...common,
          barcode: form.barcode.trim() || null,
          description: form.description.trim() || null,
          categoryId: form.categoryId || null,
          unitCost: form.unitCost ? form.unitCost : null,
          active: form.active,
        });
      }
      return catalogService.createProduct({
        ...common,
        internalCode: form.internalCode,
        ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.categoryId ? { categoryId: form.categoryId } : {}),
        ...(form.unitCost ? { unitCost: form.unitCost } : {}),
      });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product', saved.id] });
      onSaved(saved);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Editar produto ${product?.internalCode}` : 'Novo produto'}
      description="Estoque não é informado aqui: o saldo nasce de movimentações conferidas."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="product-form" loading={save.isPending}>Salvar</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Código interno" required hint={editing ? 'Não pode ser alterado (histórico e leituras dependem dele).' : undefined}>
          {(id) => <Input id={id} value={form.internalCode} disabled={editing} maxLength={40} onChange={(event) => set('internalCode', event.target.value)} />}
        </Field>
        <Field label="Código de barras">
          {(id) => <Input id={id} value={form.barcode} maxLength={64} onChange={(event) => set('barcode', event.target.value)} />}
        </Field>
        <Field label="Nome" required className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} maxLength={160} onChange={(event) => set('name', event.target.value)} />}
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={form.description} maxLength={1000} onChange={(event) => set('description', event.target.value)} />}
        </Field>
        <Field label="Categoria">
          {(id) => (
            <Select id={id} value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>
              <option value="">Sem categoria</option>
              {categories.data?.items.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Nova categoria">
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} value={newCategory} maxLength={80} onChange={(event) => setNewCategory(event.target.value)} placeholder="Nome" />
              <Button variant="secondary" onClick={() => createCategory.mutate()} disabled={newCategory.trim().length < 2} loading={createCategory.isPending}>
                Adicionar
              </Button>
            </div>
          )}
        </Field>
        <Field label="Unidade de medida" required hint={editing ? 'Só pode mudar enquanto o produto não tiver saldo nem operações pendentes.' : undefined}>
          {(id) => (
            <Select id={id} value={form.unit} onChange={(event) => set('unit', event.target.value as Unit)}>
              {(Object.keys(UNIT) as Unit[]).map((unit) => <option key={unit} value={unit}>{UNIT[unit]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Classe de manuseio" hint="Contexto para indicadores de produtividade.">
          {(id) => (
            <Select id={id} value={form.handlingClass} onChange={(event) => set('handlingClass', event.target.value as HandlingClass)}>
              {(Object.keys(HANDLING_CLASS) as HandlingClass[]).map((value) => <option key={value} value={value}>{HANDLING_CLASS[value]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Estoque mínimo">
          {(id) => <Input id={id} inputMode="decimal" value={form.minStock} onChange={(event) => set('minStock', event.target.value)} />}
        </Field>
        <Field label="Custo unitário (R$)" hint="Usado apenas para estimar o valor das divergências.">
          {(id) => <Input id={id} inputMode="decimal" value={form.unitCost} onChange={(event) => set('unitCost', event.target.value)} />}
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Controla lote" checked={form.tracksLot} onChange={(event) => set('tracksLot', event.target.checked)} />
          <Checkbox label="Controla validade" description="Exige controle de lote." checked={form.tracksLot && form.tracksExpiry} disabled={!form.tracksLot} onChange={(event) => set('tracksExpiry', event.target.checked)} />
          {editing && <Checkbox label="Produto ativo" checked={form.active} onChange={(event) => set('active', event.target.checked)} />}
        </div>
        {(save.error || createCategory.error) && (
          <div className="sm:col-span-2">
            <ErrorMessage error={save.error ?? createCategory.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}
