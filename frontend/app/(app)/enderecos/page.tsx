'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, Notice, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { ActiveBadge, LocationStatusBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePermissions } from '@/hooks/use-session';
import { formatNumber } from '@/lib/format';
import { LOCATION_STATUS } from '@/lib/labels';
import { locationService } from '@/services';
import type { LocationStatus, Sector } from '@/types/api';

type Tab = 'locations' | 'sectors' | 'warehouses';

function SectorSelect({ sectors, value, onChange, label = 'Setor', allowAll = false }: { sectors: Sector[]; value: string; onChange: (value: string) => void; label?: string; allowAll?: boolean }) {
  return (
    <Field label={label} required={!allowAll}>
      {(id) => (
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{allowAll ? 'Todos' : 'Selecione'}</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.warehouse.code} · {sector.code} — {sector.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export default function LocationsPage() {
  const { can } = usePermissions();
  const canManage = can('locations.manage');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('locations');

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: locationService.warehouses });
  const sectors = useQuery({ queryKey: ['sectors'], queryFn: () => locationService.sectors() });
  const activeSectors = useMemo(() => (sectors.data?.items ?? []).filter((sector) => sector.active), [sectors.data]);

  // Endereços
  const [filters, setFilters] = useState({ warehouseId: '', sectorId: '', status: '', search: '' });
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(filters.search);
  const locationQuery = { warehouseId: filters.warehouseId, sectorId: filters.sectorId, status: filters.status, search, page, pageSize: 25 };
  const locations = useQuery({ queryKey: ['locations', locationQuery], queryFn: () => locationService.locations(locationQuery), placeholderData: keepPreviousData, enabled: tab === 'locations' });

  const [newLocation, setNewLocation] = useState<{ sectorId: string; aisle: string; shelf: string; position: string; capacity: string } | null>(null);
  const [bulk, setBulk] = useState<{ sectorId: string; aisles: string; shelfFrom: string; shelfTo: string; positionFrom: string; positionTo: string; capacity: string } | null>(null);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['locations'] }),
    queryClient.invalidateQueries({ queryKey: ['sectors'] }),
    queryClient.invalidateQueries({ queryKey: ['warehouses'] }),
  ]);

  const createLocation = useMutation({
    mutationFn: () => locationService.createLocation({ ...newLocation, capacity: newLocation?.capacity || undefined }),
    onSuccess: async () => {
      setNewLocation(null);
      await invalidate();
    },
  });

  const bulkCreate = useMutation({
    mutationFn: () =>
      locationService.bulkCreate({
        sectorId: bulk!.sectorId,
        aisles: bulk!.aisles.split(/[,;\s]+/u).map((value) => value.trim()).filter(Boolean),
        shelfFrom: Number(bulk!.shelfFrom),
        shelfTo: Number(bulk!.shelfTo),
        positionFrom: Number(bulk!.positionFrom),
        positionTo: Number(bulk!.positionTo),
        ...(bulk!.capacity ? { capacity: bulk!.capacity } : {}),
      }),
    onSuccess: invalidate,
  });

  // Setores e armazéns
  const [sectorForm, setSectorForm] = useState({ warehouseId: '', code: '', name: '' });
  const [warehouseForm, setWarehouseForm] = useState({ code: '', name: '' });
  const createSector = useMutation({ mutationFn: () => locationService.createSector(sectorForm), onSuccess: async () => { setSectorForm({ warehouseId: '', code: '', name: '' }); await invalidate(); } });
  const createWarehouse = useMutation({ mutationFn: () => locationService.createWarehouse(warehouseForm), onSuccess: async () => { setWarehouseForm({ code: '', name: '' }); await invalidate(); } });
  const toggleSector = useMutation({ mutationFn: (sector: Sector) => locationService.updateSector(sector.id, { active: !sector.active }), onSuccess: invalidate });
  const toggleWarehouse = useMutation({ mutationFn: (warehouse: { id: string; active: boolean }) => locationService.updateWarehouse(warehouse.id, { active: !warehouse.active }), onSuccess: invalidate });

  const bulkCount = bulk
    ? bulk.aisles.split(/[,;\s]+/u).filter(Boolean).length * Math.max(0, Number(bulk.shelfTo) - Number(bulk.shelfFrom) + 1) * Math.max(0, Number(bulk.positionTo) - Number(bulk.positionFrom) + 1)
    : 0;
  const previewSector = activeSectors.find((sector) => sector.id === newLocation?.sectorId);

  return (
    <>
      <PageHeader title="Endereços" description="Armazéns, setores e posições de armazenagem" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'locations', label: 'Endereços' },
          { value: 'sectors', label: 'Setores' },
          { value: 'warehouses', label: 'Armazéns' },
        ]}
      />

      {tab === 'locations' && (
        <Card
          actions={
            canManage && (
              <>
                <Button variant="secondary" icon={<Grid3x3 className="size-4" />} onClick={() => { bulkCreate.reset(); setBulk({ sectorId: '', aisles: '01', shelfFrom: '1', shelfTo: '5', positionFrom: '1', positionTo: '4', capacity: '' }); }}>
                  Gerar em lote
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setNewLocation({ sectorId: '', aisle: '', shelf: '', position: '', capacity: '' })}>
                  Novo endereço
                </Button>
              </>
            )
          }
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Armazém">
              {(id) => (
                <Select id={id} value={filters.warehouseId} onChange={(event) => { setFilters({ ...filters, warehouseId: event.target.value, sectorId: '' }); setPage(1); }}>
                  <option value="">Todos</option>
                  {warehouses.data?.items.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
                </Select>
              )}
            </Field>
            <SectorSelect allowAll sectors={(sectors.data?.items ?? []).filter((sector) => !filters.warehouseId || sector.warehouseId === filters.warehouseId)} value={filters.sectorId} onChange={(value) => { setFilters({ ...filters, sectorId: value }); setPage(1); }} />
            <Field label="Status">
              {(id) => (
                <Select id={id} value={filters.status} onChange={(event) => { setFilters({ ...filters, status: event.target.value }); setPage(1); }}>
                  <option value="">Todos</option>
                  {(Object.keys(LOCATION_STATUS) as LocationStatus[]).map((status) => <option key={status} value={status}>{LOCATION_STATUS[status]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Código">{(id) => <Input id={id} placeholder="Ex.: A-01" value={filters.search} onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setPage(1); }} />}</Field>
          </div>
          {locations.error && <ErrorMessage error={locations.error} />}
          <DataTable
            loading={locations.isFetching}
            rows={locations.data?.items}
            rowKey={(row) => row.id}
            emptyTitle="Nenhum endereço encontrado"
            columns={[
              { key: 'code', header: 'Endereço', cell: (row) => <span className="font-mono font-medium">{row.code}</span> },
              { key: 'warehouse', header: 'Armazém', cell: (row) => row.warehouse.code },
              { key: 'sector', header: 'Setor', cell: (row) => `${row.sector.code} — ${row.sector.name}` },
              { key: 'capacity', header: 'Capacidade', cell: (row) => formatNumber(row.capacity) },
              { key: 'status', header: 'Status', cell: (row) => <LocationStatusBadge status={row.status} /> },
              { key: 'actions', header: '', className: 'text-right', cell: (row) => <LinkButton href={`/enderecos/${row.id}`} variant="secondary" size="sm">Ver conteúdo</LinkButton> },
            ]}
          />
          {locations.data && <Pagination page={locations.data.page} totalPages={locations.data.totalPages} total={locations.data.total} pageSize={locations.data.pageSize} onChange={setPage} />}
        </Card>
      )}

      {tab === 'sectors' && (
        <Card>
          {canManage && (
            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end">
              <Field label="Armazém">
                {(id) => (
                  <Select id={id} value={sectorForm.warehouseId} onChange={(event) => setSectorForm({ ...sectorForm, warehouseId: event.target.value })}>
                    <option value="">Selecione</option>
                    {warehouses.data?.items.filter((warehouse) => warehouse.active).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Código">{(id) => <Input id={id} maxLength={10} placeholder="A" value={sectorForm.code} onChange={(event) => setSectorForm({ ...sectorForm, code: event.target.value })} />}</Field>
              <Field label="Nome">{(id) => <Input id={id} maxLength={120} placeholder="Armazenagem" value={sectorForm.name} onChange={(event) => setSectorForm({ ...sectorForm, name: event.target.value })} />}</Field>
              <Button onClick={() => createSector.mutate()} loading={createSector.isPending} disabled={!sectorForm.warehouseId || !sectorForm.code || sectorForm.name.length < 2}>Criar setor</Button>
            </div>
          )}
          {(createSector.error || toggleSector.error) && <div className="mb-4"><ErrorMessage error={createSector.error ?? toggleSector.error} /></div>}
          <DataTable
            rows={sectors.data?.items}
            loading={sectors.isFetching}
            rowKey={(row) => row.id}
            columns={[
              { key: 'warehouse', header: 'Armazém', cell: (row) => row.warehouse.code },
              { key: 'code', header: 'Código', cell: (row) => <span className="font-mono">{row.code}</span> },
              { key: 'name', header: 'Nome', cell: (row) => row.name },
              { key: 'locations', header: 'Endereços', cell: (row) => row._count.locations },
              { key: 'status', header: 'Status', cell: (row) => <ActiveBadge active={row.active} /> },
              { key: 'actions', header: '', className: 'text-right', cell: (row) => canManage && <Button size="sm" variant="secondary" onClick={() => toggleSector.mutate(row)}>{row.active ? 'Inativar' : 'Ativar'}</Button> },
            ]}
          />
        </Card>
      )}

      {tab === 'warehouses' && (
        <Card>
          {canManage && (
            <div className="mb-5 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
              <Field label="Código">{(id) => <Input id={id} maxLength={20} placeholder="CD1" value={warehouseForm.code} onChange={(event) => setWarehouseForm({ ...warehouseForm, code: event.target.value })} />}</Field>
              <Field label="Nome">{(id) => <Input id={id} maxLength={120} value={warehouseForm.name} onChange={(event) => setWarehouseForm({ ...warehouseForm, name: event.target.value })} />}</Field>
              <Button onClick={() => createWarehouse.mutate()} loading={createWarehouse.isPending} disabled={!warehouseForm.code || warehouseForm.name.length < 2}>Criar armazém</Button>
            </div>
          )}
          {(createWarehouse.error || toggleWarehouse.error) && <div className="mb-4"><ErrorMessage error={createWarehouse.error ?? toggleWarehouse.error} /></div>}
          <DataTable
            rows={warehouses.data?.items}
            loading={warehouses.isFetching}
            rowKey={(row) => row.id}
            columns={[
              { key: 'code', header: 'Código', cell: (row) => <span className="font-mono">{row.code}</span> },
              { key: 'name', header: 'Nome', cell: (row) => row.name },
              { key: 'sectors', header: 'Setores', cell: (row) => row._count.sectors },
              { key: 'locations', header: 'Endereços', cell: (row) => row._count.locations },
              { key: 'status', header: 'Status', cell: (row) => <ActiveBadge active={row.active} /> },
              { key: 'actions', header: '', className: 'text-right', cell: (row) => canManage && <Button size="sm" variant="secondary" onClick={() => toggleWarehouse.mutate(row)}>{row.active ? 'Inativar' : 'Ativar'}</Button> },
            ]}
          />
        </Card>
      )}

      {newLocation && (
        <Modal
          open
          title="Novo endereço"
          description="O código é montado pelo sistema: SETOR-CORREDOR-PRATELEIRA-POSIÇÃO."
          onClose={() => setNewLocation(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setNewLocation(null)}>Cancelar</Button>
              <Button loading={createLocation.isPending} disabled={!newLocation.sectorId || !newLocation.aisle || !newLocation.shelf || !newLocation.position} onClick={() => createLocation.mutate()}>Criar</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3"><SectorSelect sectors={activeSectors} value={newLocation.sectorId} onChange={(value) => setNewLocation({ ...newLocation, sectorId: value })} /></div>
            <Field label="Corredor" required>{(id) => <Input id={id} maxLength={10} placeholder="01" value={newLocation.aisle} onChange={(event) => setNewLocation({ ...newLocation, aisle: event.target.value })} />}</Field>
            <Field label="Prateleira" required>{(id) => <Input id={id} maxLength={10} placeholder="02" value={newLocation.shelf} onChange={(event) => setNewLocation({ ...newLocation, shelf: event.target.value })} />}</Field>
            <Field label="Posição" required>{(id) => <Input id={id} maxLength={10} placeholder="03" value={newLocation.position} onChange={(event) => setNewLocation({ ...newLocation, position: event.target.value })} />}</Field>
            <Field label="Capacidade de referência" hint="Gera aviso, não bloqueio." className="sm:col-span-3">{(id) => <Input id={id} inputMode="decimal" value={newLocation.capacity} onChange={(event) => setNewLocation({ ...newLocation, capacity: event.target.value })} />}</Field>
            {previewSector && newLocation.aisle && newLocation.shelf && newLocation.position && (
              <p className="text-sm sm:col-span-3">Código gerado: <span className="font-mono font-semibold">{[previewSector.code, newLocation.aisle, newLocation.shelf, newLocation.position].map((part) => part.toUpperCase()).join('-')}</span></p>
            )}
            {createLocation.error && <div className="sm:col-span-3"><ErrorMessage error={createLocation.error} /></div>}
          </div>
        </Modal>
      )}

      {bulk && (
        <Modal
          open
          size="lg"
          title="Gerar endereços em lote"
          description="Cria a grade corredor × prateleira × posição. Endereços já existentes são ignorados."
          onClose={() => setBulk(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setBulk(null)}>Fechar</Button>
              <Button loading={bulkCreate.isPending} disabled={!bulk.sectorId || bulkCount < 1 || bulkCount > 1000} onClick={() => bulkCreate.mutate()}>Gerar {bulkCount} endereço(s)</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><SectorSelect sectors={activeSectors} value={bulk.sectorId} onChange={(value) => setBulk({ ...bulk, sectorId: value })} /></div>
            <Field label="Corredores" hint="Separados por vírgula. Ex.: 01, 02, 03" className="sm:col-span-2">{(id) => <Input id={id} value={bulk.aisles} onChange={(event) => setBulk({ ...bulk, aisles: event.target.value })} />}</Field>
            <Field label="Prateleira inicial">{(id) => <Input id={id} type="number" min={1} max={99} value={bulk.shelfFrom} onChange={(event) => setBulk({ ...bulk, shelfFrom: event.target.value })} />}</Field>
            <Field label="Prateleira final">{(id) => <Input id={id} type="number" min={1} max={99} value={bulk.shelfTo} onChange={(event) => setBulk({ ...bulk, shelfTo: event.target.value })} />}</Field>
            <Field label="Posição inicial">{(id) => <Input id={id} type="number" min={1} max={99} value={bulk.positionFrom} onChange={(event) => setBulk({ ...bulk, positionFrom: event.target.value })} />}</Field>
            <Field label="Posição final">{(id) => <Input id={id} type="number" min={1} max={99} value={bulk.positionTo} onChange={(event) => setBulk({ ...bulk, positionTo: event.target.value })} />}</Field>
            <Field label="Capacidade de referência" className="sm:col-span-2">{(id) => <Input id={id} inputMode="decimal" value={bulk.capacity} onChange={(event) => setBulk({ ...bulk, capacity: event.target.value })} />}</Field>
            {bulkCount > 1000 && <div className="sm:col-span-2"><Notice tone="warning">No máximo 1000 endereços por lote.</Notice></div>}
            {bulkCreate.error && <div className="sm:col-span-2"><ErrorMessage error={bulkCreate.error} /></div>}
            {bulkCreate.data && (
              <div className="sm:col-span-2">
                <Notice tone="success" title={`${bulkCreate.data.created} endereço(s) criado(s)`}>
                  {bulkCreate.data.skippedCodes.length > 0 ? `Já existiam e foram ignorados: ${bulkCreate.data.skippedCodes.slice(0, 20).join(', ')}${bulkCreate.data.skippedCodes.length > 20 ? '…' : ''}` : 'Nenhum código repetido.'}
                </Notice>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
