'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BarList, TrendChart } from '@/components/charts';
import { PeriodSelect, startOfDayIso } from '@/components/filters';
import { Card, Notice, PageHeader, Spinner, StatCard } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Select } from '@/components/ui/form';
import { formatBucket, formatCurrency, formatDateTime, formatElapsed, formatNumber, formatPercent } from '@/lib/format';
import { analyticsService } from '@/services';

function Trend({ value, goodWhen, suffix = '%' }: { value: number | null; goodWhen: 'up' | 'down' | 'neutral'; suffix?: string }) {
  if (value === null) return <span className="text-neutral-400">sem base de comparação</span>;
  const up = value > 0;
  const tone = goodWhen === 'neutral' || value === 0 ? 'text-neutral-500' : (up === (goodWhen === 'up') ? 'text-emerald-600' : 'text-red-600');
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Icon className="size-3.5" aria-hidden />
      {formatNumber(Math.abs(value), 2)}
      {suffix} vs. período anterior
    </span>
  );
}

export default function DashboardPage() {
  const [days, setDays] = useState('30');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const from = useMemo(() => startOfDayIso(Number(days)), [days]);

  const { data, error, isPending } = useQuery({
    queryKey: ['dashboard', from, granularity],
    queryFn: () => analyticsService.dashboard({ from, granularity }),
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral do estoque e das operações"
        actions={
          <div className="flex flex-wrap gap-3">
            <PeriodSelect value={days} onChange={setDays} />
            <Field label="Agrupar por">
              {(id) => (
                <Select id={id} value={granularity} onChange={(event) => setGranularity(event.target.value as typeof granularity)}>
                  <option value="day">Dia</option>
                  <option value="week">Semana</option>
                  <option value="month">Mês</option>
                </Select>
              )}
            </Field>
          </div>
        }
      />

      {error && <ErrorMessage error={error} />}
      {isPending && <Spinner />}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total de movimentações" value={formatNumber(data.metrics.confirmedMovements)} trend={<Trend value={data.comparison.confirmedMovements} goodWhen="neutral" />} />
            <StatCard
              label="Divergências encontradas"
              value={formatNumber(data.metrics.discrepancies)}
              trend={<Trend value={data.comparison.discrepancies} goodWhen="down" />}
              hint={data.metrics.discardedDiscrepancies > 0 ? `${data.metrics.discardedDiscrepancies} descartada(s) não entram na contagem` : undefined}
            />
            <StatCard
              label="Taxa de divergência"
              value={formatPercent(data.metrics.discrepancyRate)}
              trend={<Trend value={data.comparison.discrepancyRatePoints} goodWhen="down" suffix=" p.p." />}
              hint={`${data.metrics.operationsWithDiscrepancy} de ${data.metrics.analyzedOperations} operações conferidas`}
            />
            <StatCard
              label="Valor estimado das divergências"
              value={formatCurrency(data.metrics.estimatedValue)}
              trend={<Trend value={data.comparison.estimatedValue} goodWhen="down" />}
              hint={data.metrics.discrepanciesWithoutValue > 0 ? `${data.metrics.discrepanciesWithoutValue} sem custo cadastrado (não somadas)` : undefined}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Evolução das divergências" description="Operações conferidas e divergências registradas por período" className="xl:col-span-2">
              <TrendChart
                data={data.series}
                xKey="bucket"
                formatX={formatBucket}
                series={[
                  { key: 'discrepancies', label: 'Divergências' },
                  { key: 'analyzedOperations', label: 'Operações conferidas' },
                ]}
              />
            </Card>
            <Card title="Produtos com mais divergências" actions={<Link href="/divergencias" className="text-xs text-neutral-500 hover:text-neutral-900">Ver todas</Link>}>
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-neutral-500">Nenhuma divergência no período.</p>
              ) : (
                <BarList items={data.topProducts.map((product) => ({ key: product.id, label: `${product.internalCode} · ${product.name}`, value: product.count, hint: product.estimatedValue > 0 ? formatCurrency(product.estimatedValue) : undefined }))} />
              )}
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card title="Operações pendentes">
              <p className="text-3xl font-semibold">{data.pending.total}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {data.pending.pendingCheck} aguardando conferência · {data.pending.pendingApproval} aguardando aprovação
              </p>
              {data.pending.oldestCreatedAt && <p className="mt-1 text-xs text-neutral-500">Mais antiga há {formatElapsed(data.pending.oldestCreatedAt)}</p>}
              <Link href="/movimentacoes?status=PENDING_CHECK" className="mt-3 inline-block text-xs font-medium text-neutral-900 underline">
                Ver pendências
              </Link>
            </Card>
            <Card title="Tempo médio de resolução">
              <p className="text-3xl font-semibold">{data.resolution.averageHours === null ? '—' : `${formatNumber(data.resolution.averageHours, 1)} h`}</p>
              <p className="mt-1 text-xs text-neutral-500">{data.resolution.resolvedCount} divergência(s) corrigida(s) ou confirmada(s)</p>
            </Card>
            <Card title="Alertas abertos">
              <p className="text-3xl font-semibold">{Object.values(data.openAlerts).reduce((sum, count) => sum + (count ?? 0), 0)}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {data.openAlerts.CRITICAL ?? 0} crítico(s) · {data.openAlerts.WARNING ?? 0} de atenção
              </p>
              <Link href="/alertas" className="mt-3 inline-block text-xs font-medium text-neutral-900 underline">
                Ver alertas
              </Link>
            </Card>
            <Card title="Setores com mais divergências">
              {data.topSectors.length === 0 ? (
                <p className="text-sm text-neutral-500">Sem registros.</p>
              ) : (
                <BarList items={data.topSectors.map((sector) => ({ key: sector.id, label: `${sector.code} · ${sector.name}`, value: sector.count }))} />
              )}
            </Card>
          </div>

          <Card title="Divergências por tipo">
            {data.discrepanciesByType.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma divergência no período.</p>
            ) : (
              <BarList items={data.discrepanciesByType.map((entry) => ({ key: entry.type, label: entry.label, value: entry.count, hint: `(${formatNumber(entry.share, 1)}%)` }))} />
            )}
          </Card>

          <Notice tone="neutral" title="Como os indicadores são calculados">
            {`Taxa de divergência: ${data.definitions.discrepancyRate}\nValor estimado: ${data.definitions.estimatedValue}\nPeríodo: ${formatDateTime(data.period.from)} a ${formatDateTime(data.period.to)}.`}
          </Notice>
        </div>
      )}
    </>
  );
}
