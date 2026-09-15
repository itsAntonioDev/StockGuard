'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { EnumSelect, OptionSelect, PeriodSelect, periodStart } from '@/components/filters';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { LinkButton } from '@/components/ui/button';
import { FilterBar, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { MovementStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { useProductOptions } from '@/hooks/use-filter-options';
import { useRememberedState } from '@/hooks/use-remembered-state';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { MOVEMENT_STATUS, MOVEMENT_TYPE } from '@/lib/labels';
import { movementService } from '@/services';
import type { MovementListItem, MovementStatus, MovementType } from '@/types/api';

/** Entrada soma, saída/separação subtrai, ajuste/inventário seguem o sinal do item; transferência não altera o total. */
function signedQuantity(row: MovementListItem): string {
  const item = row.items[0];
  if (!item) return '—';
  const text = formatNumber(item.quantity ?? item.expectedQuantity);
  const sign = row.type === 'ENTRY' ? 1 : row.type === 'EXIT' || row.type === 'PICKING' ? -1 : row.type === 'TRANSFER' ? 0 : item.direction;
  return sign > 0 ? `+${text}` : sign < 0 ? `-${text}` : text;
}

function route(row: MovementListItem): string {
  const item = row.items[0];
  if (!item) return '—';
  const from = item.fromLocation?.code ?? (row.type === 'ENTRY' ? 'Fornecedor' : null);
  const to = item.toLocation?.code ?? (row.type === 'EXIT' || row.type === 'PICKING' ? 'Expedição' : null);
  if (from && to) return `${from} → ${to}`;
  return from ?? to ?? '—';
}

const movementCode =(number: number) => `MOV-${String(number).padStart(3, '0')}`;

function MovementsList() {
  const searchParams = useSearchParams();
  const { can } = usePermissions();
  const products = useProductOptions();
  const [type, setType] = useRememberedState<MovementType | ''>('movimentacoes:tipo', '');
  const [days, setDays] = useRememberedState('movimentacoes:periodo', '30');
  const [productId, setProductId] = useRememberedState('movimentacoes:produto', '');
  const [rememberedStatus, setRememberedStatus] = useRememberedState<MovementStatus | ''>('movimentacoes:status', '');
  // Link do dashboard (?status=PENDING_CHECK) tem prioridade até o usuário mudar o filtro.
  const [linkedStatus, setLinkedStatus] = useState(searchParams.get('status') as MovementStatus | null);
  const status = linkedStatus ?? rememberedStatus;
  const [page, setPage] = useState(1);
  const from = useMemo(() => (linkedStatus ? undefined : periodStart(days)), [days, linkedStatus]);

  const query = { type, status, productId, from, page, pageSize: 20 };
  const { data, error, isFetching } = useQuery({ queryKey: ['movements', query], queryFn: () => movementService.list(query), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="Movimentações de Estoque"
        description={can('movements.read.all') ? 'Registre e acompanhe todas as movimentações' : 'Suas movimentações e as filas de trabalho disponíveis para você'}
        actions={can('movements.create', 'movements.adjust.request') && <LinkButton href="/movimentacoes/nova" icon={<Plus className="size-4" />}>Nova movimentação</LinkButton>}
      />

      <FilterBar>
        <EnumSelect label="Tipo de operação" value={type} options={MOVEMENT_TYPE} onChange={(value) => { setType(value); setPage(1); }} />
        <PeriodSelect allowAll value={linkedStatus ? '' : days} onChange={(value) => { setDays(value); setLinkedStatus(null); setPage(1); }} />
        <OptionSelect label="Produto" value={productId} options={products} onChange={(value) => { setProductId(value); setPage(1); }} />
        <EnumSelect
          label="Status"
          value={status}
          options={MOVEMENT_STATUS}
          onChange={(value) => {
            setRememberedStatus(value);
            setLinkedStatus(null);
            setPage(1);
          }}
        />
      </FilterBar>

      {error && <ErrorMessage error={error} />}
      <DataTable
        loading={isFetching}
        rows={data?.items}
        rowKey={(row) => row.id}
        emptyTitle="Nenhuma movimentação encontrada"
        columns={[
          { key: 'number', header: 'ID', cell: (row) => <Link href={`/movimentacoes/${row.id}`} className="hover:underline">{movementCode(row.number)}</Link> },
          {
            key: 'product',
            header: 'Produto',
            cell: (row) => (
              <span>
                {row.items[0]?.product.name ?? '—'}
                {row._count.items > 1 && <span className="ml-1 text-xs text-neutral-400">+{row._count.items - 1} itens</span>}
              </span>
            ),
          },
          { key: 'type', header: 'Tipo', cell: (row) => MOVEMENT_TYPE[row.type] },
          { key: 'quantity', header: 'Quantidade', cell: signedQuantity },
          { key: 'route', header: 'Origem → Destino', cell: route },
          { key: 'operator', header: 'Operador', cell: (row) => row.createdBy.name },
          { key: 'date', header: 'Data/Hora', cell: (row) => formatDateTime(row.createdAt) },
          { key: 'status', header: 'Status', cell: (row) => <MovementStatusBadge status={row.status} /> },
          {
            key: 'actions',
            header: 'Ações',
            className: 'w-16 text-right',
            cell: (row) => (
              <ActionsMenu
                items={[
                  { label: 'Ver detalhes', href: `/movimentacoes/${row.id}` },
                  { label: 'Conferir', href: `/conferencia/${row.id}`, hidden: row.status !== 'PENDING_CHECK' || !can('checks.perform') },
                ]}
              />
            ),
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={setPage} itemLabel="movimentações" />}
    </>
  );
}

export default function MovementsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MovementsList />
    </Suspense>
  );
}
