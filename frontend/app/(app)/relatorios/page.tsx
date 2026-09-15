'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ChartColumn, FileSpreadsheet, TriangleAlert, Warehouse } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { BarList } from '@/components/charts';
import { OptionSelect, PeriodSelect, periodStart } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { Card, FilterBar, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { DataTable, Pagination } from '@/components/ui/table';
import { useOperatorOptions, useProductOptions, useSectorOptions } from '@/hooks/use-filter-options';
import { usePermissions } from '@/hooks/use-session';
import { downloadFile } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCurrency, formatDateOnly, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { analyticsService, type ReportKey } from '@/services';
import type { ReportRow } from '@/types/api';

const REPORTS: Record<ReportKey, { title: string; description: string; icon: ReactNode; columns: Record<string, string> }> = {
  movements: {
    title: 'Movimentações de Estoque',
    description: 'Detalhes de todas as movimentações',
    icon: <ArrowLeftRight className="size-5" aria-hidden />,
    columns: { number: 'Nº', type: 'Tipo', status: 'Status', createdAt: 'Criada em', productCode: 'Código', productName: 'Produto', lot: 'Lote', expectedQuantity: 'Qtd. solicitada', confirmedQuantity: 'Qtd. confirmada', unit: 'Unid.', from: 'Origem', to: 'Destino', createdBy: 'Registrado por', checkedBy: 'Conferido por' },
  },
  discrepancies: {
    title: 'Divergências',
    description: 'Relatório de divergências encontradas',
    icon: <TriangleAlert className="size-5" aria-hidden />,
    columns: { number: 'Nº', type: 'Tipo', status: 'Status', origin: 'Origem', createdAt: 'Registrada em', productCode: 'Código', productName: 'Produto', location: 'Endereço', sector: 'Setor', expectedQuantity: 'Esperada', foundQuantity: 'Encontrada', estimatedValue: 'Valor estimado', probableCause: 'Causa provável' },
  },
  productivity: {
    title: 'Produtividade',
    description: 'Desempenho da operação por tipo e setor',
    icon: <ChartColumn className="size-5" aria-hidden />,
    columns: { grouping: 'Agrupamento', group: 'Grupo', volume: 'Volume', sufficientSample: 'Amostra suficiente', averageMinutes: 'Min./operação', averageMinutesPerItem: 'Min./item', accuracy: 'Precisão (%)', rework: 'Retrabalho/operação', resolutionHours: 'Resolução (h)' },
  },
  stock: {
    title: 'Estoque Atual',
    description: 'Saldo atual por produto',
    icon: <Warehouse className="size-5" aria-hidden />,
    columns: { productCode: 'Código', productName: 'Produto', category: 'Categoria', location: 'Endereço', sector: 'Setor', lot: 'Lote', expiresAt: 'Validade', quantity: 'Quantidade', unit: 'Unid.', productTotal: 'Saldo total', minStock: 'Mínimo', belowMinimum: 'Abaixo do mínimo' },
  },
};

function renderCell(key: string, value: ReportRow[string]) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'estimatedValue' && typeof value === 'number') return formatCurrency(value);
  if (key === 'expiresAt') return formatDateOnly(String(value));
  if (key.endsWith('At')) return formatDateTime(String(value));
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return key === 'number' ? value : formatNumber(value, 2);
  return value;
}

interface Filters {
  days: string;
  productId: string;
  userId: string;
  sectorId: string;
}

const INITIAL_FILTERS: Filters = { days: '30', productId: '', userId: '', sectorId: '' };

export default function ReportsPage() {
  const { can } = usePermissions();
  const products = useProductOptions();
  const operators = useOperatorOptions();
  const sectors = useSectorOptions();
  const [draft, setDraft] = useState<Filters>(INITIAL_FILTERS);
  const [applied, setApplied] = useState<Filters>(INITIAL_FILTERS);
  const [active, setActive] = useState<ReportKey>('discrepancies');
  const [page, setPage] = useState(1);
  const from = useMemo(() => periodStart(applied.days), [applied.days]);

  /** Cada relatório recebe apenas os filtros que fazem sentido para ele (produtividade nunca é filtrada por pessoa). */
  const reportQuery = (key: ReportKey) => {
    switch (key) {
      case 'movements':
        return { from, productId: applied.productId, userId: applied.userId, sectorId: applied.sectorId };
      case 'discrepancies':
        return { from, productId: applied.productId, operationUserId: applied.userId, sectorId: applied.sectorId };
      case 'productivity':
        return { from, sectorId: applied.sectorId };
      case 'stock':
        return { productId: applied.productId, sectorId: applied.sectorId };
    }
  };

  const summary = useQuery({ queryKey: ['report-summary', from, applied.sectorId], queryFn: () => analyticsService.reportSummary({ from, sectorId: applied.sectorId }) });
  const preview = useQuery({
    queryKey: ['report', active, applied, page],
    queryFn: () => analyticsService.report(active, { ...reportQuery(active), page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const exportCsv = useMutation({ mutationFn: (key: ReportKey) => downloadFile(`/reports/${key}`, { format: 'csv', ...reportQuery(key) }, `${key}.csv`) });

  const columns = Object.entries(REPORTS[active].columns).map(([key, header]) => ({ key, header, cell: (row: ReportRow) => renderCell(key, row[key] ?? null) }));
  const update = (patch: Partial<Filters>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <>
      <PageHeader title="Relatórios" description="Visualize e exporte relatórios personalizados" />

      <FilterBar>
        <PeriodSelect allowAll value={draft.days} onChange={(days) => update({ days })} />
        <OptionSelect label="Produto" value={draft.productId} options={products} onChange={(productId) => update({ productId })} />
        {can('users.read') && <OptionSelect label="Operador" value={draft.userId} options={operators} onChange={(userId) => update({ userId })} />}
        <OptionSelect label="Setor" value={draft.sectorId} options={sectors} onChange={(sectorId) => update({ sectorId })} />
        <Button
          onClick={() => {
            setApplied(draft);
            setPage(1);
          }}
        >
          Gerar relatório
        </Button>
      </FilterBar>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(REPORTS) as ReportKey[]).map((key) => (
            <article key={key} className={cn('flex flex-col justify-between gap-4 rounded-lg border bg-white p-4', active === key ? 'border-neutral-900' : 'border-neutral-200')}>
              <button type="button" onClick={() => { setActive(key); setPage(1); }} className="flex items-start gap-3 text-left" aria-pressed={active === key}>
                <span className="rounded-md border border-neutral-200 p-2 text-neutral-700">{REPORTS[key].icon}</span>
                <span>
                  <span className="block text-[13px] font-semibold text-neutral-900">{REPORTS[key].title}</span>
                  <span className="block text-xs text-neutral-500">{REPORTS[key].description}</span>
                </span>
              </button>
              {can('reports.export') && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  icon={<FileSpreadsheet className="size-4" />}
                  loading={exportCsv.isPending && exportCsv.variables === key}
                  onClick={() => exportCsv.mutate(key)}
                >
                  CSV
                </Button>
              )}
            </article>
          ))}
        </div>
        {exportCsv.error && <ErrorMessage error={exportCsv.error} />}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card title="Relatório em destaque">
            <h3 className="mb-4 text-[13px] font-semibold text-neutral-900">Divergências por tipo</h3>
            {summary.isPending && <Spinner />}
            {summary.error && <ErrorMessage error={summary.error} />}
            {summary.data &&
              (summary.data.discrepanciesByType.length === 0 ? (
                <p className="text-xs text-neutral-500">Nenhuma divergência no período.</p>
              ) : (
                <BarList
                  items={summary.data.discrepanciesByType.map((entry) => ({ key: entry.type, label: `${entry.label} (${formatNumber(entry.share, 0)}%)`, value: entry.count }))}
                />
              ))}
          </Card>
          <Card title="Resumo do período">
            <dl className="space-y-4">
              <div>
                <dt className="text-xs text-neutral-500">Total de movimentações</dt>
                <dd className="mt-0.5 text-xl font-semibold">{formatNumber(summary.data?.metrics.confirmedMovements)}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Total de divergências</dt>
                <dd className="mt-0.5 text-xl font-semibold">{formatNumber(summary.data?.metrics.discrepancies)}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Taxa de divergência</dt>
                <dd className="mt-0.5 text-xl font-semibold">{formatPercent(summary.data?.metrics.discrepancyRate)}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <Card
          title={REPORTS[active].title}
          description={active === 'stock' ? 'Posição atual (o período não se aplica).' : active === 'productivity' ? 'Indicadores agregados da operação — nunca por pessoa.' : 'Exportações ficam registradas na auditoria.'}
        >
          {preview.error && <ErrorMessage error={preview.error} />}
          <DataTable loading={preview.isFetching} rows={preview.data?.items} rowKey={(row) => JSON.stringify(row).slice(0, 200)} columns={columns} />
          {preview.data && <Pagination page={preview.data.page} totalPages={preview.data.totalPages} total={preview.data.total} pageSize={preview.data.pageSize} onChange={setPage} />}
        </Card>
      </div>
    </>
  );
}
