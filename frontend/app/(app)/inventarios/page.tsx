'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProgressBar } from '@/components/charts';
import { EnumSelect } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { Card, Notice, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { InventoryStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';
import { INVENTORY_STATUS } from '@/lib/labels';
import { inventoryService, locationService } from '@/services';
import type { InventoryStatus } from '@/types/api';

export default function InventoriesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [status, setStatus] = useState<InventoryStatus | ''>('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ warehouseId: string; sectorId: string; blind: boolean; notes: string } | null>(null);

  const query = { status, page, pageSize: 20 };
  const inventories = useQuery({ queryKey: ['inventories', query], queryFn: () => inventoryService.list(query), placeholderData: keepPreviousData });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: locationService.warehouses, enabled: Boolean(form) });
  const sectors = useQuery({ queryKey: ['sectors'], queryFn: () => locationService.sectors(), enabled: Boolean(form) });

  const open = useMutation({
    mutationFn: () => inventoryService.open({ warehouseId: form!.warehouseId, blind: form!.blind, ...(form!.sectorId ? { sectorId: form!.sectorId } : {}), ...(form!.notes.trim() ? { notes: form!.notes.trim() } : {}) }),
    onSuccess: async (inventory) => {
      await queryClient.invalidateQueries({ queryKey: ['inventories'] });
      router.push(`/inventarios/${inventory.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Inventários"
        description="Contagens físicas para reconciliar o estoque do sistema"
        actions={can('inventory.manage') && <Button icon={<Plus className="size-4" />} onClick={() => { open.reset(); setForm({ warehouseId: '', sectorId: '', blind: true, notes: '' }); }}>Abrir inventário</Button>}
      />
      <Card>
        <div className="mb-4 max-w-xs"><EnumSelect label="Status" value={status} options={INVENTORY_STATUS} onChange={(value) => { setStatus(value); setPage(1); }} /></div>
        {inventories.error && <ErrorMessage error={inventories.error} />}
        <DataTable
          loading={inventories.isFetching}
          rows={inventories.data?.items}
          rowKey={(row) => row.id}
          emptyTitle="Nenhum inventário"
          columns={[
            { key: 'number', header: 'Nº', cell: (row) => <Link href={`/inventarios/${row.id}`} className="font-mono font-medium underline">INV-{String(row.number).padStart(4, '0')}</Link> },
            { key: 'scope', header: 'Escopo', cell: (row) => `${row.warehouse.code} · ${row.sector ? `Setor ${row.sector.code}` : 'Armazém inteiro'}` },
            { key: 'status', header: 'Status', cell: (row) => <InventoryStatusBadge status={row.status} /> },
            { key: 'progress', header: 'Progresso', cell: (row) => <ProgressBar value={row.progress.counted} total={row.progress.total} /> },
            { key: 'blind', header: 'Contagem cega', cell: (row) => (row.blind ? 'Sim' : 'Não') },
            { key: 'createdBy', header: 'Aberto por', cell: (row) => row.createdBy.name },
            { key: 'createdAt', header: 'Aberto em', cell: (row) => formatDateTime(row.createdAt) },
          ]}
        />
        {inventories.data && <Pagination page={inventories.data.page} totalPages={inventories.data.totalPages} total={inventories.data.total} pageSize={inventories.data.pageSize} onChange={setPage} />}
      </Card>

      {form && (
        <Modal
          open
          title="Abrir inventário"
          description="Os endereços do escopo ficam bloqueados para movimentações até a conclusão."
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button loading={open.isPending} disabled={!form.warehouseId} onClick={() => open.mutate()}>Abrir</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Armazém" required>
              {(id) => (
                <Select id={id} value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value, sectorId: '' })}>
                  <option value="">Selecione</option>
                  {warehouses.data?.items.filter((warehouse) => warehouse.active).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Setor" hint="Deixe em branco para inventariar o armazém inteiro.">
              {(id) => (
                <Select id={id} value={form.sectorId} onChange={(event) => setForm({ ...form, sectorId: event.target.value })} disabled={!form.warehouseId}>
                  <option value="">Armazém inteiro</option>
                  {sectors.data?.items.filter((sector) => sector.active && sector.warehouseId === form.warehouseId).map((sector) => <option key={sector.id} value={sector.id}>{sector.code} — {sector.name}</option>)}
                </Select>
              )}
            </Field>
            <Checkbox label="Contagem cega" description="Quem conta não vê a quantidade do sistema (recomendado)." checked={form.blind} onChange={(event) => setForm({ ...form, blind: event.target.checked })} />
            <Field label="Observações">{(id) => <Textarea id={id} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />}</Field>
            <Notice tone="info">Operações pendentes no escopo impedem a abertura: conclua ou cancele-as antes.</Notice>
            {open.error && <ErrorMessage error={open.error} />}
          </div>
        </Modal>
      )}
    </>
  );
}
