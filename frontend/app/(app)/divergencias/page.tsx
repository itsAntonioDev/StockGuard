'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EnumSelect, PeriodSelect, startOfDayIso } from '@/components/filters';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { DiscrepancyStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { downloadFile } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { DISCREPANCY_STATUS, DISCREPANCY_TYPE } from '@/lib/labels';
import { discrepancyService } from '@/services';
import type { DiscrepancyStatus, DiscrepancyType } from '@/types/api';

export default function DiscrepanciesPage() {
  const { can } = usePermissions();
  const [days, setDays] = useState('30');
  const [type, setType] = useState<DiscrepancyType | ''>('');
  const [status, setStatus] = useState<DiscrepancyStatus | ''>('');
  const [page, setPage] = useState(1);
  const from = useMemo(() => startOfDayIso(Number(days)), [days]);

  const query = { from, type, status, page, pageSize: 20 };
  const { data, error, isFetching } = useQuery({ queryKey: ['discrepancies', query], queryFn: () => discrepancyService.list(query), placeholderData: keepPreviousData });
  const exportCsv = useMutation({ mutationFn: () => downloadFile('/reports/discrepancies', { format: 'csv', from, type, status }, 'divergencias.csv') });

  return (
    <>
      <PageHeader
        title="Divergências de estoque"
        description="Registre, analise e resolva as divergências identificadas"
        actions={
          <>
            {can('reports.export') && <Button variant="secondary" icon={<Download className="size-4" />} loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>Exportar CSV</Button>}
            {can('discrepancies.create') && <LinkButton href="/divergencias/nova" icon={<Plus className="size-4" />}>Registrar divergência</LinkButton>}
          </>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <PeriodSelect value={days} onChange={(value) => { setDays(value); setPage(1); }} />
          <EnumSelect label="Tipo" value={type} options={DISCREPANCY_TYPE} onChange={(value) => { setType(value); setPage(1); }} />
          <EnumSelect label="Status" value={status} options={DISCREPANCY_STATUS} onChange={(value) => { setStatus(value); setPage(1); }} />
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          “Operação de” indica quem executou a operação relacionada — é contexto para análise do processo, não atribuição de responsabilidade.
        </p>
        {(error || exportCsv.error) && <ErrorMessage error={error ?? exportCsv.error} />}
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(row) => row.id}
          emptyTitle="Nenhuma divergência no período"
          columns={[
            { key: 'number', header: 'ID', cell: (row) => <Link href={`/divergencias/${row.id}`} className="font-mono font-medium underline">DIV-{String(row.number).padStart(4, '0')}</Link> },
            { key: 'product', header: 'Produto', cell: (row) => row.product ? `${row.product.internalCode} · ${row.product.name}` : '—' },
            { key: 'type', header: 'Tipo', cell: (row) => DISCREPANCY_TYPE[row.type] },
            { key: 'expected', header: 'Qtd. esperada', cell: (row) => formatNumber(row.expectedQuantity) },
            { key: 'found', header: 'Qtd. encontrada', cell: (row) => formatNumber(row.foundQuantity) },
            { key: 'location', header: 'Endereço', cell: (row) => <span className="font-mono">{row.location?.code ?? '—'}</span> },
            { key: 'operation', header: 'Operação de', cell: (row) => row.operationUser?.name ?? '—' },
            { key: 'status', header: 'Status', cell: (row) => <DiscrepancyStatusBadge status={row.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
      </Card>
    </>
  );
}
