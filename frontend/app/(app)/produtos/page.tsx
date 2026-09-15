'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, ScanBarcode } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProductFormModal } from '@/components/products/product-form-modal';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Select } from '@/components/ui/form';
import { SearchInput } from '@/components/ui/search-input';
import { ActiveBadge } from '@/components/ui/status';
import { DataTable, Pagination } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useRememberedState } from '@/hooks/use-remembered-state';
import { usePermissions } from '@/hooks/use-session';
import { formatNumber } from '@/lib/format';
import { catalogService } from '@/services';

export default function ProductsPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [search, setSearch] = useRememberedState('produtos:busca', '');
  // '' = todos · 'true'/'false' = ativo/inativo · 'below' = abaixo do mínimo
  const [status, setStatus] = useRememberedState('produtos:status', '');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const query = {
    search: debouncedSearch,
    active: status === 'true' || status === 'false' ? status : undefined,
    belowMinimum: status === 'below' ? 'true' : undefined,
    page,
    pageSize: 20,
  };
  const { data, error, isFetching } = useQuery({
    queryKey: ['products', query],
    queryFn: () => catalogService.products(query),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Gerencie o cadastro de produtos do estoque"
        actions={can('products.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo produto</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          className="w-full sm:w-96"
          aria-label="Buscar produtos"
          placeholder="Buscar por nome, código ou código de barras..."
          trailing={<ScanBarcode className="size-4" aria-hidden />}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Select className="w-full sm:w-44" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Todos os status</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
          <option value="below">Abaixo do mínimo</option>
        </Select>
      </div>

      {error && <ErrorMessage error={error} />}
      <DataTable
        loading={isFetching}
        rows={data?.items}
        rowKey={(row) => row.id}
        emptyTitle="Nenhum produto encontrado"
        columns={[
          { key: 'code', header: 'Código', cell: (row) => row.internalCode },
          { key: 'name', header: 'Produto', cell: (row) => row.name },
          { key: 'category', header: 'Categoria', cell: (row) => row.category?.name ?? '—' },
          {
            key: 'stock',
            header: 'Estoque atual',
            cell: (row) => (
              <span className={row.belowMinimum ? 'font-medium text-red-600' : undefined} title={row.belowMinimum ? 'Abaixo do estoque mínimo' : undefined}>
                {formatNumber(row.stockTotal)} <span className="text-xs text-neutral-400">{row.unit}</span>
              </span>
            ),
          },
          { key: 'min', header: 'Estoque mínimo', cell: (row) => formatNumber(row.minStock) },
          { key: 'status', header: 'Status', cell: (row) => <ActiveBadge active={row.active} /> },
          {
            key: 'actions',
            header: 'Ações',
            className: 'w-16 text-right',
            cell: (row) => <ActionsMenu items={[{ label: 'Ver detalhes', href: `/produtos/${row.id}` }]} />,
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onChange={setPage} itemLabel="produtos" />}

      {creating && <ProductFormModal open onClose={() => setCreating(false)} onSaved={(product) => router.push(`/produtos/${product.id}`)} />}
    </>
  );
}
