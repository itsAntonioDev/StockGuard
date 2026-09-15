'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, DescriptionList, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input, Select } from '@/components/ui/form';
import { LocationStatusBadge } from '@/components/ui/status';
import { DataTable } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatDateOnly, formatDateTime, formatNumber } from '@/lib/format';
import { LOCATION_STATUS } from '@/lib/labels';
import { locationService } from '@/services';
import type { LocationStatus } from '@/types/api';

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ status: LocationStatus; capacity: string } | null>(null);

  const location = useQuery({ queryKey: ['location', id], queryFn: () => locationService.location(id) });
  const update = useMutation({
    mutationFn: () => locationService.updateLocation(id, { status: draft!.status, capacity: draft!.capacity ? draft!.capacity : null }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['location', id] });
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });

  if (location.error) return <ErrorMessage error={location.error} />;
  if (!location.data) return <Spinner />;
  const data = location.data;

  return (
    <>
      <PageHeader title={`Endereço ${data.code}`} description={`${data.warehouse.name} · Setor ${data.sector.code} — ${data.sector.name}`} />
      <div className="space-y-6">
        <Card
          actions={can('locations.manage') && !draft && <Button variant="secondary" onClick={() => setDraft({ status: data.status, capacity: data.capacity != null ? String(data.capacity) : '' })}>Alterar status/capacidade</Button>}
        >
          <DescriptionList
            items={[
              { label: 'Status', value: <LocationStatusBadge status={data.status} /> },
              { label: 'Corredor / Prateleira / Posição', value: `${data.aisle} / ${data.shelf} / ${data.position}` },
              { label: 'Capacidade de referência', value: formatNumber(data.capacity) },
              { label: 'Quantidade armazenada', value: formatNumber(data.occupiedQuantity) },
              { label: 'Atualizado em', value: formatDateTime(data.updatedAt) },
            ]}
          />
          {draft && (
            <div className="mt-5 grid gap-3 border-t border-neutral-100 pt-5 sm:grid-cols-[200px_200px_auto_auto] sm:items-end">
              <Field label="Status">
                {(fieldId) => (
                  <Select id={fieldId} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as LocationStatus })}>
                    {(Object.keys(LOCATION_STATUS) as LocationStatus[]).map((status) => <option key={status} value={status}>{LOCATION_STATUS[status]}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Capacidade">{(fieldId) => <Input id={fieldId} inputMode="decimal" value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} />}</Field>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button loading={update.isPending} onClick={() => update.mutate()}>Salvar</Button>
              <p className="text-xs text-neutral-500 sm:col-span-4">Endereços bloqueados ou inativos não recebem movimentações. Para inativar, o endereço precisa estar vazio.</p>
              {update.error && <div className="sm:col-span-4"><ErrorMessage error={update.error} /></div>}
            </div>
          )}
        </Card>

        <Card title="Produtos armazenados">
          <DataTable
            rows={data.contents}
            rowKey={(row) => `${row.product.id}-${row.lot?.id ?? 'sem-lote'}`}
            emptyTitle="Endereço vazio"
            columns={[
              { key: 'code', header: 'Código', cell: (row) => <Link className="font-mono underline" href={`/produtos/${row.product.id}`}>{row.product.internalCode}</Link> },
              { key: 'name', header: 'Produto', cell: (row) => row.product.name },
              { key: 'lot', header: 'Lote', cell: (row) => (row.lot ? `${row.lot.code}${row.lot.expiresAt ? ` (val. ${formatDateOnly(row.lot.expiresAt)})` : ''}` : '—') },
              { key: 'qty', header: 'Quantidade', cell: (row) => `${formatNumber(row.quantity)} ${row.product.unit}` },
              { key: 'updated', header: 'Última movimentação', cell: (row) => formatDateTime(row.updatedAt) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
