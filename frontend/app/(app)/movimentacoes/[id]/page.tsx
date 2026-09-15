'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanBarcode } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ReasonModal } from '@/components/reason-modal';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, DescriptionList, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { DiscrepancyStatusBadge, MovementStatusBadge } from '@/components/ui/status';
import { DataTable } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatDateOnly, formatDateTime, formatNumber } from '@/lib/format';
import { DISCREPANCY_TYPE, MOVEMENT_TYPE } from '@/lib/labels';
import { movementService } from '@/services';
import type { MovementDetail } from '@/types/api';

function MovementDetailView() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const warnings = searchParams.get('avisos');
  const { me, can } = usePermissions();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'cancel' | 'reject' | null>(null);

  const movement = useQuery({ queryKey: ['movement', id], queryFn: () => movementService.get(id) });
  const onDone = async (updated: MovementDetail) => {
    setModal(null);
    queryClient.setQueryData(['movement', id], updated);
    await queryClient.invalidateQueries({ queryKey: ['movements'] });
  };
  const cancel = useMutation({ mutationFn: (reason: string) => movementService.cancel(id, reason), onSuccess: onDone });
  const reject = useMutation({ mutationFn: (reason: string) => movementService.reject(id, reason), onSuccess: onDone });
  const approve = useMutation({ mutationFn: () => movementService.approve(id), onSuccess: onDone });

  if (movement.error) return <ErrorMessage error={movement.error} />;
  if (!movement.data || !me) return <Spinner />;
  const data = movement.data;
  const pending = data.status === 'PENDING_CHECK' || data.status === 'PENDING_APPROVAL';
  const isCreator = data.createdById === me.user.id;

  return (
    <>
      <PageHeader
        title={`MOV-${String(data.number).padStart(4, '0')} · ${MOVEMENT_TYPE[data.type]}`}
        description={`${data.warehouse.code} — ${data.warehouse.name}`}
        actions={
          <>
            {data.status === 'PENDING_CHECK' && can('checks.perform') && <LinkButton href={`/conferencia/${data.id}`} icon={<ScanBarcode className="size-4" />}>Conferir</LinkButton>}
            {data.status === 'PENDING_APPROVAL' && data.type === 'ADJUSTMENT' && can('movements.adjust.approve') && !isCreator && (
              <>
                <Button variant="success" loading={approve.isPending} onClick={() => approve.mutate()}>Aprovar ajuste</Button>
                <Button variant="secondary" onClick={() => setModal('reject')}>Rejeitar</Button>
              </>
            )}
            {pending && (isCreator || can('movements.cancel')) && <Button variant="secondary" onClick={() => setModal('cancel')}>Cancelar</Button>}
          </>
        }
      />

      <div className="space-y-6">
        {warnings && <Notice tone="warning" title="Registrada com avisos">{warnings.split(' | ').join('\n')}</Notice>}
        {approve.error && <ErrorMessage error={approve.error} />}
        {data.status === 'PENDING_APPROVAL' && isCreator && <Notice tone="info">Você solicitou este ajuste. A aprovação deve ser feita por outra pessoa.</Notice>}

        <Card>
          <DescriptionList
            items={[
              { label: 'Status', value: <MovementStatusBadge status={data.status} /> },
              { label: 'Registrada por', value: `${data.createdBy.name} em ${formatDateTime(data.createdAt)}` },
              { label: 'Documento', value: data.referenceDoc ?? '—' },
              { label: 'Conferência iniciada', value: formatDateTime(data.checkStartedAt) },
              { label: 'Conferida por', value: data.checkedBy ? `${data.checkedBy.name} em ${formatDateTime(data.checkedAt)}` : '—' },
              { label: 'Aprovada por', value: data.approvedBy ? `${data.approvedBy.name} em ${formatDateTime(data.approvedAt)}` : '—' },
              { label: 'Confirmada em', value: formatDateTime(data.confirmedAt) },
              { label: data.status === 'REJECTED' ? 'Rejeitada por' : 'Cancelada por', value: data.cancelledBy ? `${data.cancelledBy.name} em ${formatDateTime(data.cancelledAt)}` : '—' },
              { label: 'Motivo do cancelamento/rejeição', value: data.cancelReason ?? '—' },
            ]}
          />
          {(data.reason || data.notes) && (
            <div className="mt-4 space-y-2 border-t border-neutral-100 pt-4 text-sm">
              {data.reason && <p><span className="font-medium">Justificativa:</span> {data.reason}</p>}
              {data.notes && <p><span className="font-medium">Observações:</span> {data.notes}</p>}
            </div>
          )}
        </Card>

        <Card title="Itens">
          <DataTable
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              { key: 'product', header: 'Produto', cell: (row) => <div><Link href={`/produtos/${row.product.id}`} className="font-mono text-xs underline">{row.product.internalCode}</Link><p>{row.product.name}</p></div> },
              { key: 'lot', header: 'Lote', cell: (row) => (row.lot ? `${row.lot.code}${row.lot.expiresAt ? ` (val. ${formatDateOnly(row.lot.expiresAt)})` : ''}` : '—') },
              { key: 'from', header: 'Origem', cell: (row) => <span className="font-mono">{row.fromLocation?.code ?? '—'}</span> },
              { key: 'to', header: 'Destino', cell: (row) => <span className="font-mono">{row.toLocation?.code ?? '—'}</span> },
              { key: 'dir', header: 'Direção', cell: (row) => (data.type === 'ADJUSTMENT' || data.type === 'INVENTORY' ? (row.direction > 0 ? 'Acréscimo' : 'Baixa') : '—') },
              { key: 'expected', header: 'Qtd. solicitada', cell: (row) => `${formatNumber(row.expectedQuantity)} ${row.unit}` },
              { key: 'confirmed', header: 'Qtd. confirmada', cell: (row) => (row.quantity === null ? '—' : <span className={row.quantity !== row.expectedQuantity ? 'font-semibold text-red-700' : ''}>{formatNumber(row.quantity)} {row.unit}</span>) },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                cell: (row) => can('discrepancies.create') && <LinkButton size="sm" variant="ghost" href={`/divergencias/nova?movementItemId=${row.id}`}>Registrar divergência</LinkButton>,
              },
            ]}
          />
        </Card>

        <Card title="Divergências vinculadas">
          <DataTable
            rows={data.discrepancies}
            rowKey={(row) => row.id}
            emptyTitle="Nenhuma divergência vinculada"
            columns={[
              { key: 'number', header: 'Nº', cell: (row) => <Link href={`/divergencias/${row.id}`} className="font-mono underline">DIV-{String(row.number).padStart(4, '0')}</Link> },
              { key: 'type', header: 'Tipo', cell: (row) => DISCREPANCY_TYPE[row.type] },
              { key: 'status', header: 'Status', cell: (row) => <DiscrepancyStatusBadge status={row.status} /> },
              { key: 'date', header: 'Registrada em', cell: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        </Card>
      </div>

      <ReasonModal open={modal === 'cancel'} title="Cancelar movimentação" description="Movimentações pendentes canceladas não alteram o estoque." confirmLabel="Cancelar movimentação" pending={cancel.isPending} error={cancel.error} onClose={() => setModal(null)} onConfirm={(reason) => cancel.mutate(reason)} />
      <ReasonModal open={modal === 'reject'} title="Rejeitar ajuste" confirmLabel="Rejeitar" pending={reject.isPending} error={reject.error} onClose={() => setModal(null)} onConfirm={(reason) => reject.mutate(reason)} />
    </>
  );
}

export default function MovementDetailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MovementDetailView />
    </Suspense>
  );
}
