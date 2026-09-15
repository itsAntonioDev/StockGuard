'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EnumSelect, OptionSelect, PeriodSelect, periodStart } from '@/components/filters';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { Button, LinkButton } from '@/components/ui/button';
import { FilterBar, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { DiscrepancyStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { useProductOptions } from '@/hooks/use-filter-options';
import { useRememberedState } from '@/hooks/use-remembered-state';
import { usePermissions } from '@/hooks/use-session';
import { downloadFile } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { DISCREPANCY_STATUS, DISCREPANCY_TYPE } from '@/lib/labels';
import { discrepancyService } from '@/services';
import type { DiscrepancyStatus } from '@/types/api';

export default function DiscrepanciesPage() {
  const { can } = usePermissions();
  const products = useProductOptions();
  const [days, setDays] = useRememberedState('divergencias:periodo', '30');
  const [productId, setProductId] = useRememberedState('divergencias:produto', '');
  const [status, setStatus] = useRememberedState<DiscrepancyStatus | ''>('divergencias:status', '');
  const [page, setPage] = useState(1);
  const from = useMemo(() => periodStart(days), [days]);

  const query = { from, productId, status, page, pageSize: 20 };
  const { data, error, isFetching } = useQuery({ queryKey: ['discrepancies', query], queryFn: () => discrepancyService.list(query), placeholderData: keepPreviousData });
  const exportCsv = useMutation({ mutationFn: () => downloadFile('/reports/discrepancies', { format: 'csv', from, productId, status }, 'divergencias.csv') });

  return (
    <>
      <PageHeader
        title="Divergências de Estoque"
        description="Gerencie e resolva as divergências identificadas"
        actions={can('discrepancies.create') && <LinkButton href="/divergencias/nova" icon={<Plus className="size-4" />}>Registrar divergência</LinkButton>}
      />

      <FilterBar
        actions={
          can('reports.export') && (
            <Button icon={<Download className="size-4" />} loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
              Exportar CSV
            </Button>
          )
        }
      >
        <PeriodSelect allowAll value={days} onChange={(value) => { setDays(value); setPage(1); }} />
        <OptionSelect label="Produto" value={productId} options={products} onChange={(value) => { setProductId(value); setPage(1); }} />
        <EnumSelect label="Status" value={status} options={DISCREPANCY_STATUS} onChange={(value) => { setStatus(value); setPage(1); }} />
      </FilterBar>

      {(error || exportCsv.error) && <ErrorMessage error={error ?? exportCsv.error} />}
      <DataTable
        loading={isFetching}
        rows={data?.items}
        rowKey={(row) => row.id}
        emptyTitle="Nenhuma divergência no período"
        columns={[
          { key: 'number', header: 'ID', cell: (row) => <Link href={`/divergencias/${row.id}`} className="hover:underline">DIV-{String(row.number).padStart(3, '0')}</Link> },
          { key: 'product', header: 'Produto', cell: (row) => row.product?.name ?? '—' },
          { key: 'type', header: 'Tipo', cell: (row) => DISCREPANCY_TYPE[row.type] },
          { key: 'expected', header: 'Qtd. Esperada', cell: (row) => formatNumber(row.expectedQuantity) },
          { key: 'found', header: 'Qtd. Encontrada', cell: (row) => formatNumber(row.foundQuantity) },
          { key: 'location', header: 'Endereço', cell: (row) => row.location?.code ?? '—' },
          // Quem executou a operação relacionada: contexto para análise do processo, não atribuição de culpa.
          { key: 'operation', header: <span title="Quem executou a operação relacionada — contexto, não responsabilidade">Operador</span>, cell: (row) => row.operationUser?.name ?? '—' },
          { key: 'status', header: 'Status', cell: (row) => <DiscrepancyStatusBadge status={row.status} /> },
          { key: 'actions', header: 'Ações', className: 'w-16 text-right', cell: (row) => <ActionsMenu items={[{ label: 'Ver detalhes', href: `/divergencias/${row.id}` }]} /> },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={setPage} itemLabel="divergências" />}
    </>
  );
}
