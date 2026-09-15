'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Bell, CalendarDays, Package } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { BarList, TrendChart } from '@/components/charts';
import { startOfDayIso } from '@/components/filters';
import { LinkButton } from '@/components/ui/button';
import { Card, PageHeader, Spinner, StatCard } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { usePermissions } from '@/hooks/use-session';
import { formatBucket, formatCurrency, formatLongDate, formatNumber, formatPercent } from '@/lib/format';
import { alertService, analyticsService } from '@/services';

function Trend({ value, goodWhen, suffix = '%' }: { value: number | null; goodWhen: 'up' | 'down' | 'neutral'; suffix?: string }) {
  if (value === null) return <span className="text-neutral-400">sem base de comparação com ontem</span>;
  const up = value > 0;
  const neutral = goodWhen === 'neutral' || value === 0;
  const color = neutral ? 'text-neutral-700' : up === (goodWhen === 'up') ? 'text-emerald-600' : 'text-red-600';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-neutral-500">
      <span className={`inline-flex items-center gap-0.5 font-medium ${color}`}>
        <Icon className="size-3.5" aria-hidden />
        {formatNumber(Math.abs(value), 2)}
        {suffix}
      </span>
      vs. ontem
    </span>
  );
}

export default function DashboardPage() {
  const { can } = usePermissions();
  const today = useMemo(() => startOfDayIso(1), []);
  const lastWeek = useMemo(() => startOfDayIso(7), []);
  const { date, weekday } = formatLongDate(new Date());

  // Indicadores do dia (comparados com ontem) e evolução dos últimos 7 dias.
  const kpis = useQuery({ queryKey: ['dashboard', 'today', today], queryFn: () => analyticsService.dashboard({ from: today, granularity: 'day' }) });
  const week = useQuery({ queryKey: ['dashboard', 'week', lastWeek], queryFn: () => analyticsService.dashboard({ from: lastWeek, granularity: 'day' }) });
  const alerts = useQuery({ queryKey: ['alerts', 'summary'], queryFn: alertService.summary, enabled: can('alerts.read'), refetchInterval: 60_000 });
  const openAlerts = Object.values(alerts.data?.open ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral do estoque e operações"
        actions={
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 text-xs">
              <CalendarDays className="size-4 text-neutral-700" aria-hidden />
              <div>
                <p className="font-medium text-neutral-900">{date}</p>
                <p className="text-neutral-500">{weekday}</p>
              </div>
            </div>
            {can('alerts.read') && (
              <Link href="/alertas" className="relative rounded-md p-2 text-neutral-700 hover:bg-neutral-100" aria-label={`Alertas (${openAlerts} abertos)`}>
                <Bell className="size-5" aria-hidden />
                {openAlerts > 0 && (
                  <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">{openAlerts}</span>
                )}
              </Link>
            )}
          </div>
        }
      />

      {(kpis.error || week.error) && <ErrorMessage error={kpis.error ?? week.error} />}
      {(kpis.isPending || week.isPending) && <Spinner />}

      {kpis.data && week.data && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total de movimentações" value={formatNumber(kpis.data.metrics.confirmedMovements)} trend={<Trend value={kpis.data.comparison.confirmedMovements} goodWhen="up" />} />
            <StatCard label="Divergências encontradas" value={formatNumber(kpis.data.metrics.discrepancies)} trend={<Trend value={kpis.data.comparison.discrepancies} goodWhen="down" />} />
            <StatCard
              label="Taxa de divergência"
              value={formatPercent(kpis.data.metrics.discrepancyRate)}
              trend={<Trend value={kpis.data.comparison.discrepancyRatePoints} goodWhen="down" suffix=" p.p." />}
            />
            <StatCard label="Valor estimado das divergências" value={formatCurrency(kpis.data.metrics.estimatedValue)} trend={<Trend value={kpis.data.comparison.estimatedValue} goodWhen="down" />} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <Card title="Evolução das divergências">
              <TrendChart
                data={week.data.series}
                xKey="bucket"
                formatX={formatBucket}
                series={[
                  { key: 'discrepancies', label: 'Divergências' },
                  { key: 'movements', label: 'Total de operações' },
                ]}
              />
            </Card>
            <Card title="Produtos com mais divergências">
              {week.data.topProducts.length === 0 ? (
                <p className="py-8 text-center text-xs text-neutral-500">Nenhuma divergência nos últimos 7 dias.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {week.data.topProducts.map((product) => (
                    <li key={product.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Package className="size-4 shrink-0 text-neutral-500" aria-hidden />
                        <span className="truncate">{product.name}</span>
                      </span>
                      <span className="font-medium">{product.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 text-right">
                <Link href="/divergencias" className="text-xs text-neutral-500 hover:text-neutral-900">
                  Ver todos
                </Link>
              </div>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-neutral-900">Operações pendentes</p>
                <p className="mt-3 text-3xl font-semibold">{kpis.data.pending.total}</p>
              </div>
              <LinkButton variant="secondary" size="sm" href="/movimentacoes?status=PENDING_CHECK">
                Ver pendências
              </LinkButton>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Tempo médio de resolução">
              <p className="text-2xl font-semibold">{week.data.resolution.averageHours === null ? '—' : `${formatNumber(week.data.resolution.averageHours, 1)} h`}</p>
              <p className="mt-1 text-xs text-neutral-500">{week.data.resolution.resolvedCount} divergência(s) resolvida(s) em 7 dias</p>
            </Card>
            <Card title="Setores com mais divergências">
              {week.data.topSectors.length === 0 ? (
                <p className="text-xs text-neutral-500">Sem registros nos últimos 7 dias.</p>
              ) : (
                <BarList items={week.data.topSectors.map((sector) => ({ key: sector.id, label: `${sector.code} · ${sector.name}`, value: sector.count }))} />
              )}
            </Card>
            <Card title="Divergências por tipo">
              {week.data.discrepanciesByType.length === 0 ? (
                <p className="text-xs text-neutral-500">Sem registros nos últimos 7 dias.</p>
              ) : (
                <BarList items={week.data.discrepanciesByType.map((entry) => ({ key: entry.type, label: entry.label, value: entry.count }))} />
              )}
            </Card>
          </div>

          <p className="text-xs text-neutral-400">
            Taxa de divergência: {kpis.data.definitions.discrepancyRate} Hoje: {kpis.data.metrics.operationsWithDiscrepancy} de {kpis.data.metrics.analyzedOperations} operações conferidas.
          </p>
        </div>
      )}
    </>
  );
}
