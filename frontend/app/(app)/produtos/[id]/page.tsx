'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProductFormModal } from '@/components/products/product-form-modal';
import { Button } from '@/components/ui/button';
import { Badge, Card, DescriptionList, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { ActiveBadge, LocationStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatCurrency, formatDateOnly, formatDateTime, formatNumber } from '@/lib/format';
import { HANDLING_CLASS, MOVEMENT_TYPE, UNIT } from '@/lib/labels';
import { catalogService } from '@/services';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lotToDelete, setLotToDelete] = useState<{ id: string; code: string } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [lot, setLot] = useState({ code: '', expiresAt: '' });

  const product = useQuery({ queryKey: ['product', id], queryFn: () => catalogService.product(id) });
  const history = useQuery({
    queryKey: ['product-history', id, historyPage],
    queryFn: () => catalogService.history(id, { page: historyPage, pageSize: 15 }),
    placeholderData: keepPreviousData,
  });

  // Só conclui para cadastro sem histórico; com movimentações o servidor recusa e explica.
  const removeProduct = useMutation({
    mutationFn: () => catalogService.deleteProduct(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      router.push('/produtos');
    },
  });

  const removeLot = useMutation({
    mutationFn: (lotId: string) => catalogService.deleteLot(lotId),
    onSuccess: async () => {
      setLotToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
  });

  const createLot = useMutation({
    mutationFn: () => catalogService.createLot(id, { code: lot.code, ...(lot.expiresAt ? { expiresAt: lot.expiresAt } : {}) }),
    onSuccess: async () => {
      setLot({ code: '', expiresAt: '' });
      await queryClient.invalidateQueries({ queryKey: ['product', id] });
    },
  });

  if (product.error) return <ErrorMessage error={product.error} />;
  if (!product.data) return <Spinner />;
  const data = product.data;

  return (
    <>
      <PageHeader
        title={data.name}
        description={`Código ${data.internalCode}${data.barcode ? ` · Código de barras ${data.barcode}` : ''}`}
        actions={
          can('products.manage') && (
            <>
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>
              <Button variant="secondary" className="text-red-700" icon={<Trash2 className="size-4" />} onClick={() => { removeProduct.reset(); setConfirmDelete(true); }}>Excluir</Button>
            </>
          )
        }
      />

      <div className="space-y-6">
        <Card>
          <DescriptionList
            items={[
              { label: 'Status', value: <ActiveBadge active={data.active} /> },
              { label: 'Estoque atual', value: <span className="flex items-center gap-2">{formatNumber(data.stockTotal)} {data.unit}{data.belowMinimum && <Badge tone="danger">Abaixo do mínimo</Badge>}</span> },
              { label: 'Estoque mínimo', value: `${formatNumber(data.minStock)} ${data.unit}` },
              { label: 'Unidade', value: UNIT[data.unit] },
              { label: 'Categoria', value: data.category?.name ?? '—' },
              { label: 'Classe de manuseio', value: HANDLING_CLASS[data.handlingClass] },
              { label: 'Custo unitário', value: formatCurrency(data.unitCost) },
              { label: 'Controle de lote', value: data.tracksLot ? (data.tracksExpiry ? 'Lote e validade' : 'Lote') : 'Não' },
              { label: 'Cadastrado em', value: formatDateTime(data.createdAt) },
            ]}
          />
          {data.description && <p className="mt-4 whitespace-pre-line text-sm text-neutral-700">{data.description}</p>}
        </Card>

        <Card title="Estoque por endereço">
          <DataTable
            rows={data.balances}
            rowKey={(row) => `${row.location.id}-${row.lot?.id ?? 'sem-lote'}`}
            emptyTitle="Sem saldo em nenhum endereço"
            columns={[
              { key: 'location', header: 'Endereço', cell: (row) => <Link className="font-mono underline" href={`/enderecos/${row.location.id}`}>{row.location.code}</Link> },
              { key: 'sector', header: 'Setor', cell: (row) => row.location.sector.name },
              { key: 'status', header: 'Status do endereço', cell: (row) => <LocationStatusBadge status={row.location.status} /> },
              { key: 'lot', header: 'Lote', cell: (row) => (row.lot ? `${row.lot.code}${row.lot.expiresAt ? ` (val. ${formatDateOnly(row.lot.expiresAt)})` : ''}` : '—') },
              { key: 'quantity', header: 'Quantidade', cell: (row) => `${formatNumber(row.quantity)} ${data.unit}` },
              { key: 'updated', header: 'Atualizado em', cell: (row) => formatDateTime(row.updatedAt) },
            ]}
          />
        </Card>

        {data.tracksLot && (
          <Card title="Lotes">
            {can('products.manage') && (
              <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                <Field label="Código do lote">{(fieldId) => <Input id={fieldId} value={lot.code} maxLength={60} onChange={(event) => setLot({ ...lot, code: event.target.value })} />}</Field>
                <Field label={`Validade${data.tracksExpiry ? ' *' : ''}`}>{(fieldId) => <Input id={fieldId} type="date" value={lot.expiresAt} onChange={(event) => setLot({ ...lot, expiresAt: event.target.value })} />}</Field>
                <Button onClick={() => createLot.mutate()} loading={createLot.isPending} disabled={!lot.code || (data.tracksExpiry && !lot.expiresAt)}>Adicionar lote</Button>
              </div>
            )}
            {createLot.error && <div className="mb-4"><ErrorMessage error={createLot.error} /></div>}
            <DataTable
              rows={data.lots}
              rowKey={(row) => row.id}
              emptyTitle="Nenhum lote cadastrado"
              columns={[
                { key: 'code', header: 'Lote', cell: (row) => <span className="font-mono">{row.code}</span> },
                { key: 'expires', header: 'Validade', cell: (row) => formatDateOnly(row.expiresAt) },
                { key: 'created', header: 'Cadastrado em', cell: (row) => formatDateTime(row.createdAt) },
                {
                  key: 'actions',
                  header: 'Ações',
                  className: 'text-right',
                  cell: (row) =>
                    can('products.manage') ? (
                      <Button variant="ghost" size="sm" className="text-red-700" icon={<Trash2 className="size-3.5" />} onClick={() => { removeLot.reset(); setLotToDelete({ id: row.id, code: row.code }); }}>
                        Excluir
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        )}

        <Card title="Histórico de movimentações" description="Lançamentos do livro-razão do estoque (não editáveis)">
          {history.error && <ErrorMessage error={history.error} />}
          <DataTable
            loading={history.isFetching}
            rows={history.data?.items}
            rowKey={(row) => row.id}
            emptyTitle="Nenhuma movimentação registrada"
            columns={[
              { key: 'date', header: 'Data/Hora', cell: (row) => formatDateTime(row.createdAt) },
              { key: 'movement', header: 'Movimentação', cell: (row) => <Link className="underline" href={`/movimentacoes/${row.movement.id}`}>#{row.movement.number} · {MOVEMENT_TYPE[row.movement.type]}</Link> },
              { key: 'location', header: 'Endereço', cell: (row) => <span className="font-mono">{row.location.code}</span> },
              { key: 'lot', header: 'Lote', cell: (row) => row.lot?.code ?? '—' },
              { key: 'delta', header: 'Variação', cell: (row) => <span className={row.delta > 0 ? 'text-emerald-700' : 'text-red-700'}>{row.delta > 0 ? '+' : ''}{formatNumber(row.delta)}</span> },
              { key: 'after', header: 'Saldo no endereço', cell: (row) => formatNumber(row.balanceAfter) },
              { key: 'user', header: 'Registrado por', cell: (row) => row.createdBy.name },
            ]}
          />
          {history.data && <Pagination page={history.data.page} totalPages={history.data.totalPages} total={history.data.total} pageSize={history.data.pageSize} onChange={setHistoryPage} />}
        </Card>
      </div>

      {editing && <ProductFormModal open product={data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}

      {confirmDelete && (
        <Modal
          open
          title={`Excluir ${data.name}?`}
          description="A exclusão só é possível enquanto o produto não tiver histórico. Para tirar de uso um produto já movimentado, desative-o na edição."
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
              <Button variant="danger" loading={removeProduct.isPending} onClick={() => removeProduct.mutate()}>Excluir produto</Button>
            </>
          }
        >
          {removeProduct.error ? <ErrorMessage error={removeProduct.error} /> : <p className="text-[13px] text-neutral-700">Esta ação não pode ser desfeita e fica registrada na auditoria.</p>}
        </Modal>
      )}

      {lotToDelete && (
        <Modal
          open
          title={`Excluir o lote ${lotToDelete.code}?`}
          description="Permitido apenas para lotes que nunca foram usados em operações."
          onClose={() => setLotToDelete(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLotToDelete(null)}>Cancelar</Button>
              <Button variant="danger" loading={removeLot.isPending} onClick={() => removeLot.mutate(lotToDelete.id)}>Excluir lote</Button>
            </>
          }
        >
          {removeLot.error ? <ErrorMessage error={removeLot.error} /> : <p className="text-[13px] text-neutral-700">Esta ação não pode ser desfeita e fica registrada na auditoria.</p>}
        </Modal>
      )}
    </>
  );
}
