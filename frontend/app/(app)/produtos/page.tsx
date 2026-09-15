'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProductFormModal } from '@/components/products/product-form-modal';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { ActiveBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePermissions } from '@/hooks/use-session';
import { formatNumber } from '@/lib/format';
import { catalogService } from '@/services';

export default function ProductsPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [belowMinimum, setBelowMinimum] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const query = { search: debouncedSearch, active: status, belowMinimum: belowMinimum ? 'true' : undefined, page, pageSize: 20 };
  const { data, error, isFetching } = useQuery({
    queryKey: ['products', query],
    queryFn: () => catalogService.products(query),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Cadastro de produtos do estoque"
        actions={can('products.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo produto</Button>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <Field label="Buscar">
            {(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                <Input
                  id={id}
                  className="pl-9"
                  placeholder="Nome, código interno ou código de barras"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="">Todos</option>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
              </Select>
            )}
          </Field>
          <Checkbox className="pb-2.5" label="Abaixo do mínimo" checked={belowMinimum} onChange={(event) => { setBelowMinimum(event.target.checked); setPage(1); }} />
        </div>

        {error && <ErrorMessage error={error} />}
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(row) => row.id}
          emptyTitle="Nenhum produto encontrado"
          columns={[
            { key: 'code', header: 'Código', cell: (row) => <span className="font-mono text-xs">{row.internalCode}</span> },
            {
              key: 'name',
              header: 'Produto',
              cell: (row) => (
                <div>
                  <p className="font-medium">{row.name}</p>
                  {row.barcode && <p className="font-mono text-xs text-neutral-500">{row.barcode}</p>}
                </div>
              ),
            },
            { key: 'category', header: 'Categoria', cell: (row) => row.category?.name ?? '—' },
            {
              key: 'stock',
              header: 'Estoque atual',
              cell: (row) => (
                <span className="flex items-center gap-2">
                  {formatNumber(row.stockTotal)} {row.unit}
                  {row.belowMinimum && <Badge tone="danger">Abaixo do mínimo</Badge>}
                </span>
              ),
            },
            { key: 'min', header: 'Estoque mínimo', cell: (row) => `${formatNumber(row.minStock)} ${row.unit}` },
            { key: 'status', header: 'Status', cell: (row) => <ActiveBadge active={row.active} /> },
            { key: 'actions', header: '', className: 'text-right', cell: (row) => <LinkButton href={`/produtos/${row.id}`} variant="secondary" size="sm">Ver</LinkButton> },
          ]}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
      </Card>

      {creating && <ProductFormModal open onClose={() => setCreating(false)} onSaved={(product) => router.push(`/produtos/${product.id}`)} />}
    </>
  );
}
