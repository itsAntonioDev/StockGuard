'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EnumSelect } from '@/components/filters';
import { LinkButton } from '@/components/ui/button';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input } from '@/components/ui/form';
import { MovementStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';
import { MOVEMENT_STATUS, MOVEMENT_TYPE } from '@/lib/labels';
import { movementService } from '@/services';
import type { MovementStatus, MovementType } from '@/types/api';

function MovementsList() {
  const searchParams = useSearchParams();
  const { can } = usePermissions();
  const [type, setType] = useState<MovementType | ''>('');
  const [status, setStatus] = useState<MovementStatus | ''>((searchParams.get('status') as MovementStatus | null) ?? '');
  const [number, setNumber] = useState('');
  const [page, setPage] = useState(1);
  const debouncedNumber = useDebouncedValue(number);

  const query = { type, status, number: /^\d+$/u.test(debouncedNumber) ? debouncedNumber : undefined, page, pageSize: 20 };
  const { data, error, isFetching } = useQuery({ queryKey: ['movements', query], queryFn: () => movementService.list(query), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="Movimentações de estoque"
        description={can('movements.read.all') ? 'Todas as movimentações registradas' : 'Suas movimentações e as filas de trabalho disponíveis para você'}
        actions={can('movements.create', 'movements.adjust.request') && <LinkButton href="/movimentacoes/nova" icon={<Plus className="size-4" />}>Nova movimentação</LinkButton>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <EnumSelect label="Tipo de operação" value={type} options={MOVEMENT_TYPE} onChange={(value) => { setType(value); setPage(1); }} />
          <EnumSelect label="Status" value={status} options={MOVEMENT_STATUS} onChange={(value) => { setStatus(value); setPage(1); }} />
          <Field label="Número">{(id) => <Input id={id} inputMode="numeric" placeholder="Ex.: 123" value={number} onChange={(event) => { setNumber(event.target.value); setPage(1); }} />}</Field>
        </div>
        {error && <ErrorMessage error={error} />}
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(row) => row.id}
          emptyTitle="Nenhuma movimentação encontrada"
          columns={[
            { key: 'number', header: 'Nº', cell: (row) => <Link href={`/movimentacoes/${row.id}`} className="font-mono font-medium underline">MOV-{String(row.number).padStart(4, '0')}</Link> },
            { key: 'type', header: 'Tipo', cell: (row) => MOVEMENT_TYPE[row.type] },
            { key: 'items', header: 'Itens', cell: (row) => row._count.items },
            { key: 'status', header: 'Status', cell: (row) => <MovementStatusBadge status={row.status} /> },
            { key: 'createdBy', header: 'Registrado por', cell: (row) => row.createdBy.name },
            { key: 'checkedBy', header: 'Conferido por', cell: (row) => row.checkedBy?.name ?? '—' },
            { key: 'date', header: 'Data/Hora', cell: (row) => formatDateTime(row.createdAt) },
            { key: 'disc', header: 'Divergências', cell: (row) => (row._count.discrepancies > 0 ? <Badge tone="danger">{row._count.discrepancies}</Badge> : '—') },
          ]}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
      </Card>
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
