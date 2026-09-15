'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Boxes, Download, Eye, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { BarList } from '@/components/charts';
import { PeriodSelect, startOfDayIso } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { Card, PageHeader, Spinner, StatCard } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Select } from '@/components/ui/form';
import { DataTable, Pagination } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { downloadFile } from '@/lib/api';
import { formatCurrency, formatDateOnly, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { analyticsService, locationService } from '@/services';
import type { ReportRow } from '@/types/api';

type ReportKey = 'movements' | 'discrepancies' | 'stock';

const REPORTS: Record<ReportKey, { title: string; description: string; icon: ReactNode; columns: Record<string, string> }> = {
  movements: {
    title: 'Movimentações de estoque',
    description: 'Itens movimentados no período',
    icon: <ArrowLeftRight className="size-5" aria-hidden />,
    columns: { number: 'Nº', type: 'Tipo', status: 'Status', createdAt: 'Criada em', productCode: 'Código', productName: 'Produto', lot: 'Lote', expectedQuantity: 'Qtd. solicitada', confirmedQuantity: 'Qtd. confirmada', unit: 'Unid.', from: 'Origem', to: 'Destino', createdBy: 'Registrado por', checkedBy: 'Conferido por' },
  },
  discrepancies: {
    title: 'Divergências',
    description: 'Divergências registradas e sua análise',
    icon: <TriangleAlert className="size-5" aria-hidden />,
    columns: { number: 'Nº', type: 'Tipo', status: 'Status', origin: 'Origem', createdAt: 'Registrada em', productCode: 'Código', productName: 'Produto', location: 'Endereço', sector: 'Setor', expectedQuantity: 'Esperada', foundQuantity: 'Encontrada', estimatedValue: 'Valor estimado', probableCause: 'Causa provável' },
  },
  stock: {
    title: 'Estoque atual',
    description: 'Saldo por produto, endereço e lote',
    icon: <Boxes className="size-5" aria-hidden />,
    columns: { productCode: 'Código', productName: 'Produto', category: 'Categoria', location: 'Endereço', sector: 'Setor', lot: 'Lote', expiresAt: 'Validade', quantity: 'Quantidade', unit: 'Unid.', productTotal: 'Saldo total', minStock: 'Mínimo', belowMinimum: 'Abaixo do mínimo' },
  },
};

function renderCell(key: string, value: ReportRow[string]) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'estimatedValue' && typeof value === 'number') return formatCurrency(value);
  if (key === 'expiresAt') return formatDateOnly(String(value));
  if (key.endsWith('At')) return formatDateTime(String(value));
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return key === 'number' ? value : formatNumber(value);
  return value;
}

export default function ReportsPage() {
  const { can } = usePermissions();
  const [days, setDays] = useState('30');
  const [sectorId, setSectorId] = useState('');
  const [active, setActive] = useState<ReportKey>('discrepancies');
  const [page, setPage] = useState(1);
  const from = useMemo(() => startOfDayIso(Number(days)), [days]);

  const sectors = useQuery({ queryKey: ['sectors'], queryFn: () => locationService.sectors(), enabled: can('locations.read') });
  const summary = useQuery({ queryKey: ['report-summary', from, sectorId], queryFn: () => analyticsService.reportSummary({ from, sectorId }) });
  const filters = active === 'stock' ? { sectorId } : { from, sectorId };
  const preview = useQuery({
    queryKey: ['report', active, filters, page],
    queryFn: () => analyticsService.report(active, { ...filters, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const exportCsv = useMutation({ mutationFn: (key: ReportKey) => downloadFile(`/reports/${key}`, { format: 'csv', ...(key === 'stock' ? { sectorId } : { from, sectorId }) }, `${key}.csv`) });

  const columns = Object.entries(REPORTS[active].columns).map(([key, header]) => ({ key, header, cell: (row: ReportRow) => renderCell(key, row[key] ?? null) }));

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Visualize e exporte relatórios. Exportações ficam registradas na auditoria."
        actions={
          <div className="flex flex-wrap gap-3">
            <PeriodSelect value={days} onChange={(value) => { setDays(value); setPage(1); }} />
            {sectors.data && (
              <Field label="Setor">
                {(id) => (
                  <Select id={id} value={sectorId} onChange={(event) => { setSectorId(event.target.value); setPage(1); }}>
                    <option value="">Todos</option>
                    {sectors.data.items.map((sector) => <option key={sector.id} value={sector.id}>{sector.warehouse.code} · {sector.code} — {sector.name}</option>)}
                  </Select>
                )}
              </Field>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(REPORTS) as ReportKey[]).map((key) => (
            <article key={key} className={`flex flex-col gap-3 rounded-lg border bg-white p-5 ${active === key ? 'border-neutral-900' : 'border-neutral-200'}`}>
              <div className="flex items-start gap-3">
                <span className="rounded-md bg-neutral-100 p-2">{REPORTS[key].icon}</span>
                <div>
                  <h2 className="text-sm font-semibold">{REPORTS[key].title}</h2>
                  <p className="text-xs text-neutral-500">{REPORTS[key].description}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Eye className="size-4" />} onClick={() => { setActive(key); setPage(1); }}>Visualizar</Button>
                {can('reports.export') && <Button size="sm" icon={<Download className="size-4" />} loading={exportCsv.isPending && exportCsv.variables === key} onClick={() => exportCsv.mutate(key)}>CSV</Button>}
              </div>
            </article>
          ))}
        </div>
        {exportCsv.error && <ErrorMessage error={exportCsv.error} />}

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card title="Divergências por tipo">
            {summary.isPending && <Spinner />}
            {summary.error && <ErrorMessage error={summary.error} />}
            {summary.data && (summary.data.discrepanciesByType.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma divergência no período.</p>
            ) : (
              <BarList items={summary.data.discrepanciesByType.map((entry) => ({ key: entry.type, label: `${entry.label} (${formatNumber(entry.share, 1)}%)`, value: entry.count }))} />
            ))}
          </Card>
          <div className="grid gap-4">
            <StatCard label="Total de movimentações" value={formatNumber(summary.data?.metrics.confirmedMovements)} />
            <StatCard label="Total de divergências" value={formatNumber(summary.data?.metrics.discrepancies)} />
            <StatCard label="Taxa de divergência" value={formatPercent(summary.data?.metrics.discrepancyRate)} hint={summary.data ? `${summary.data.metrics.operationsWithDiscrepancy} de ${summary.data.metrics.analyzedOperations} operações conferidas` : undefined} />
          </div>
        </div>

        <Card title={REPORTS[active].title} description={active === 'stock' ? 'Posição atual (o período não se aplica).' : undefined}>
          {preview.error && <ErrorMessage error={preview.error} />}
          <DataTable loading={preview.isFetching} rows={preview.data?.items} rowKey={(row) => JSON.stringify(row).slice(0, 200)} columns={columns} />
          {preview.data && <Pagination page={preview.data.page} totalPages={preview.data.totalPages} total={preview.data.total} pageSize={preview.data.pageSize} onChange={setPage} />}
        </Card>
      </div>
    </>
  );
}
