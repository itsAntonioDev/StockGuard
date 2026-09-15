'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ProgressBar } from '@/components/charts';
import { ReasonModal } from '@/components/reason-modal';
import { Button } from '@/components/ui/button';
import { Card, DescriptionList, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { InventoryStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { inventoryService } from '@/services';
import type { InventoryDetail } from '@/types/api';

const COUNT_MESSAGE = {
  COUNT: 'Contagem registrada.',
  RECOUNT: 'Recontagem registrada — a primeira contagem foi preservada no histórico.',
  UNEXPECTED: 'Produto não esperado neste endereço: registrado e será analisado no envio.',
};

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const productInput = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState({ locationCode: '', productCode: '', lotCode: '', lotExpiresAt: '', quantity: '' });
  const [onlyPending, setOnlyPending] = useState(false);
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<'submit' | 'approve' | 'cancel' | null>(null);

  const inventory = useQuery({ queryKey: ['inventory', id], queryFn: () => inventoryService.get(id) });
  const itemsQuery = { onlyPending: onlyPending ? 'true' : undefined, page, pageSize: 50 };
  const items = useQuery({ queryKey: ['inventory-items', id, itemsQuery], queryFn: () => inventoryService.items(id, itemsQuery), placeholderData: keepPreviousData });

  const refresh = async (updated?: InventoryDetail) => {
    if (updated) queryClient.setQueryData(['inventory', id], updated);
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['inventory', id] }), queryClient.invalidateQueries({ queryKey: ['inventory-items', id] }), queryClient.invalidateQueries({ queryKey: ['inventories'] })]);
  };

  const register = useMutation({
    mutationFn: () =>
      inventoryService.count(id, {
        locationCode: count.locationCode.trim(),
        productCode: count.productCode.trim(),
        quantity: count.quantity.trim().replace(',', '.'),
        ...(count.lotCode.trim() ? { lotCode: count.lotCode.trim() } : {}),
        ...(count.lotExpiresAt ? { lotExpiresAt: count.lotExpiresAt } : {}),
      }),
    onSuccess: async () => {
      // Mantém o endereço: normalmente vários produtos são contados no mesmo local.
      setCount((current) => ({ ...current, productCode: '', lotCode: '', lotExpiresAt: '', quantity: '' }));
      productInput.current?.focus();
      await refresh();
    },
  });
  const submit = useMutation({ mutationFn: () => inventoryService.submit(id), onSuccess: async (data) => { setConfirming(null); await refresh(data); } });
  const approve = useMutation({ mutationFn: () => inventoryService.approve(id), onSuccess: async (data) => { setConfirming(null); await refresh(data); } });
  const cancel = useMutation({ mutationFn: (reason: string) => inventoryService.cancel(id, reason), onSuccess: async (data) => { setConfirming(null); await refresh(data); } });

  if (inventory.error) return <ErrorMessage error={inventory.error} />;
  if (!inventory.data) return <Spinner />;
  const data = inventory.data;
  const inProgress = data.status === 'OPEN' || data.status === 'SUBMITTED';

  function submitCount(event: FormEvent) {
    event.preventDefault();
    register.mutate();
  }

  return (
    <>
      <PageHeader
        title={`INV-${String(data.number).padStart(4, '0')}`}
        description={`${data.warehouse.name} · ${data.sector ? `Setor ${data.sector.code} — ${data.sector.name}` : 'Armazém inteiro'}`}
        actions={
          <>
            {data.status === 'OPEN' && can('inventory.manage') && <Button onClick={() => setConfirming('submit')}>Enviar para revisão</Button>}
            {data.status === 'SUBMITTED' && can('inventory.approve') && <Button variant="success" onClick={() => setConfirming('approve')}>Aprovar ajustes</Button>}
            {inProgress && can('inventory.manage') && <Button variant="secondary" onClick={() => setConfirming('cancel')}>Cancelar</Button>}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <DescriptionList
            items={[
              { label: 'Status', value: <InventoryStatusBadge status={data.status} /> },
              { label: 'Progresso', value: <ProgressBar value={data.progress.counted} total={data.progress.total} /> },
              { label: 'Contagem cega', value: data.blind ? 'Sim' : 'Não' },
              { label: 'Aberto por', value: `${data.createdBy.name} em ${formatDateTime(data.createdAt)}` },
              { label: 'Enviado em', value: formatDateTime(data.submittedAt) },
              { label: 'Aprovado por', value: data.approvedBy ? `${data.approvedBy.name} em ${formatDateTime(data.approvedAt)}` : '—' },
              { label: 'Divergências geradas', value: data.discrepancies > 0 ? <Link className="underline" href="/divergencias">{data.discrepancies}</Link> : '0' },
              { label: 'Movimentação de ajuste', value: data.movement ? <Link className="underline" href={`/movimentacoes/${data.movement.id}`}>MOV-{String(data.movement.number).padStart(4, '0')}</Link> : '—' },
            ]}
          />
          {data.notes && <p className="mt-4 text-sm text-neutral-700">{data.notes}</p>}
        </Card>

        {inProgress && <Notice tone="warning">Os endereços deste inventário estão bloqueados para novas movimentações até a aprovação ou cancelamento.</Notice>}

        {data.status === 'OPEN' && can('inventory.count') && (
          <Card title="Registrar contagem" description="Leia o endereço, o produto e informe a quantidade encontrada. Informe 0 quando o produto não estiver no endereço.">
            <form onSubmit={submitCount} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <Field label="Endereço" required>{(fieldId) => <Input id={fieldId} className="font-mono" value={count.locationCode} onChange={(event) => setCount({ ...count, locationCode: event.target.value })} autoComplete="off" />}</Field>
              <Field label="Produto" required>{(fieldId) => <Input ref={productInput} id={fieldId} value={count.productCode} onChange={(event) => setCount({ ...count, productCode: event.target.value })} autoComplete="off" />}</Field>
              <Field label="Lote" hint="Se o produto controlar lote.">{(fieldId) => <Input id={fieldId} value={count.lotCode} onChange={(event) => setCount({ ...count, lotCode: event.target.value })} />}</Field>
              <Field label="Quantidade" required>{(fieldId) => <Input id={fieldId} inputMode="decimal" value={count.quantity} onChange={(event) => setCount({ ...count, quantity: event.target.value })} />}</Field>
              <Button type="submit" size="lg" loading={register.isPending} disabled={!count.locationCode || !count.productCode || count.quantity === ''}>Registrar</Button>
              {count.lotCode && (
                <Field label="Validade (lote novo)" className="lg:col-span-2">{(fieldId) => <Input id={fieldId} type="date" value={count.lotExpiresAt} onChange={(event) => setCount({ ...count, lotExpiresAt: event.target.value })} />}</Field>
              )}
            </form>
            {register.data && <div className="mt-4"><Notice tone={register.data.kind === 'UNEXPECTED' ? 'warning' : 'success'}>{`${COUNT_MESSAGE[register.data.kind]} ${register.data.item.product.internalCode} em ${register.data.item.location.code}.`}</Notice></div>}
            {register.error && <div className="mt-4"><ErrorMessage error={register.error} /></div>}
          </Card>
        )}

        <Card title="Itens" actions={<Checkbox label="Somente não contados" checked={onlyPending} onChange={(event) => { setOnlyPending(event.target.checked); setPage(1); }} />}>
          {!data.showsSystemQuantity && <p className="mb-3 text-xs text-neutral-500">Contagem cega: a quantidade do sistema será exibida após o envio para revisão.</p>}
          {items.error && <ErrorMessage error={items.error} />}
          <DataTable
            loading={items.isFetching}
            rows={items.data?.items}
            rowKey={(row) => row.id}
            emptyTitle={onlyPending ? 'Todos os itens foram contados' : 'Nenhum item no escopo'}
            columns={[
              { key: 'location', header: 'Endereço', cell: (row) => <span className="font-mono">{row.location.code}</span> },
              { key: 'product', header: 'Produto', cell: (row) => `${row.product.internalCode} · ${row.product.name}` },
              { key: 'lot', header: 'Lote', cell: (row) => row.lot?.code ?? '—' },
              { key: 'counted', header: 'Contado', cell: (row) => formatNumber(row.countedQuantity) },
              { key: 'recount', header: 'Recontagem', cell: (row) => formatNumber(row.recountQuantity) },
              ...(data.showsSystemQuantity
                ? [
                    { key: 'system', header: 'Sistema', cell: (row: (typeof items.data & object)['items'][number]) => formatNumber(row.systemQuantity) },
                    {
                      key: 'difference',
                      header: 'Diferença',
                      cell: (row: (typeof items.data & object)['items'][number]) =>
                        row.difference === null ? '—' : <span className={row.difference === 0 ? 'text-neutral-600' : 'font-semibold text-red-700'}>{row.difference > 0 ? '+' : ''}{formatNumber(row.difference)}</span>,
                    },
                  ]
                : []),
              { key: 'by', header: 'Contado por', cell: (row) => (row.countedBy ? `${row.countedBy.name} · ${formatDateTime(row.countedAt)}` : '—') },
            ]}
          />
          {items.data && <Pagination page={items.data.page} totalPages={items.data.totalPages} total={items.data.total} pageSize={items.data.pageSize} onChange={setPage} />}
        </Card>
      </div>

      <Modal
        open={confirming === 'submit' || confirming === 'approve'}
        title={confirming === 'submit' ? 'Enviar para revisão' : 'Aprovar ajustes do inventário'}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>Voltar</Button>
            {confirming === 'submit' ? (
              <Button loading={submit.isPending} onClick={() => submit.mutate()}>Enviar</Button>
            ) : (
              <Button variant="success" loading={approve.isPending} onClick={() => approve.mutate()}>Aprovar e ajustar estoque</Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {confirming === 'submit' ? (
            <p>Todos os itens precisam estar contados. Cada diferença encontrada vira uma divergência para análise.</p>
          ) : (
            <p>O estoque de cada endereço será ajustado para a quantidade contada por meio de uma movimentação de inventário rastreável. A aprovação deve ser feita por quem não abriu o inventário.</p>
          )}
          {(submit.error || approve.error) && <ErrorMessage error={submit.error ?? approve.error} />}
        </div>
      </Modal>
      <ReasonModal open={confirming === 'cancel'} title="Cancelar inventário" description="Os endereços são liberados e nenhum ajuste é aplicado." confirmLabel="Cancelar inventário" pending={cancel.isPending} error={cancel.error} onClose={() => setConfirming(null)} onConfirm={(reason) => cancel.mutate(reason)} />
    </>
  );
}
