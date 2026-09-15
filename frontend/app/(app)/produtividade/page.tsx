'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { TrendChart } from '@/components/charts';
import { PeriodSelect, startOfDayIso } from '@/components/filters';
import { Badge, Card, DescriptionList, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Select } from '@/components/ui/form';
import { DataTable } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatBucket, formatNumber, formatPercent } from '@/lib/format';
import { CHECK_ERROR, HANDLING_CLASS } from '@/lib/labels';
import { adminService, analyticsService } from '@/services';

export default function ProductivityPage() {
  const { can } = usePermissions();
  const canSeeAll = can('productivity.read.all');
  const [days, setDays] = useState('30');
  const [userId, setUserId] = useState('');
  const from = useMemo(() => startOfDayIso(Number(days)), [days]);

  const users = useQuery({ queryKey: ['users', 'active'], queryFn: () => adminService.users({ active: 'true', pageSize: 100 }), enabled: canSeeAll && can('users.read') });
  const report = useQuery({ queryKey: ['productivity', from, userId], queryFn: () => analyticsService.productivity({ from, userId }) });

  const evolution = useMemo(() => {
    if (!report.data) return { rows: [] as Array<Record<string, string | number | null>>, sectors: [] as string[] };
    const sectors = [...new Set(report.data.weeklyEvolution.map((entry) => entry.sectorCode))];
    const byWeek = new Map<string, Record<string, string | number | null>>();
    for (const entry of report.data.weeklyEvolution) {
      const row = byWeek.get(entry.week) ?? { week: entry.week };
      row[entry.sectorCode] = entry.attemptAccuracy;
      byWeek.set(entry.week, row);
    }
    return { rows: [...byWeek.values()], sectors };
  }, [report.data]);

  return (
    <>
      <PageHeader
        title="Produtividade"
        description={canSeeAll ? 'Indicadores para melhorar processos e direcionar treinamentos' : 'Seus indicadores de conferência'}
        actions={
          <div className="flex flex-wrap gap-3">
            <PeriodSelect value={days} onChange={setDays} />
            {canSeeAll && users.data && (
              <Field label="Visão">
                {(id) => (
                  <Select id={id} value={userId} onChange={(event) => setUserId(event.target.value)}>
                    <option value="">Toda a operação</option>
                    {users.data.items.map((user) => <option key={user.id} value={user.id}>{user.name} (apoio individual)</option>)}
                  </Select>
                )}
              </Field>
            )}
          </div>
        }
      />

      {report.error && <ErrorMessage error={report.error} />}
      {report.isPending && <Spinner />}

      {report.data && (
        <div className="space-y-6">
          <Notice tone="info" title="Como ler estes indicadores">{report.data.notes.join('\n')}</Notice>

          {report.data.individual && (
            <Card title={`Contexto de ${report.data.individual.user.name}`} description="Use para planejar apoio e treinamento, nunca como critério isolado de avaliação.">
              <DescriptionList
                items={[
                  { label: 'Perfil', value: report.data.individual.user.role },
                  { label: 'Setor', value: report.data.individual.user.sector?.name ?? '—' },
                  { label: 'Tempo desde o início do treinamento', value: report.data.individual.trainingDays === null ? 'Não informado' : `${report.data.individual.trainingDays} dias` },
                  {
                    label: 'Operações por classe de manuseio',
                    value: report.data.individual.operationsByHandlingClass.length === 0 ? '—' : report.data.individual.operationsByHandlingClass.map((entry) => `${HANDLING_CLASS[entry.handlingClass]}: ${entry.operations}`).join(' · '),
                  },
                ]}
              />
            </Card>
          )}

          <Card title="Por tipo de operação" description="Tempos acompanhados da complexidade média (itens e quantidade).">
            <DataTable
              rows={report.data.byOperationType}
              rowKey={(row) => row.type}
              emptyTitle="Nenhuma operação conferida no período"
              columns={[
                { key: 'type', header: 'Tipo', cell: (row) => <span className="flex items-center gap-2">{row.label}{!row.sufficientSample && <Badge tone="warning">Amostra pequena</Badge>}</span> },
                { key: 'ops', header: 'Operações', cell: (row) => row.operations },
                { key: 'items', header: 'Itens médios', cell: (row) => formatNumber(row.averageItems, 1) },
                { key: 'qty', header: 'Qtd. média', cell: (row) => formatNumber(row.averageQuantity, 1) },
                { key: 'minutes', header: 'Min. por operação', cell: (row) => formatNumber(row.averageMinutes, 1) },
                { key: 'perItem', header: 'Min. por item', cell: (row) => formatNumber(row.averageMinutesPerItem, 2) },
                { key: 'perHour', header: 'Ops/hora ativa', cell: (row) => formatNumber(row.operationsPerActiveHour, 1) },
                { key: 'first', header: 'Conferência correta na 1ª tentativa', cell: (row) => formatPercent(row.firstPassAccuracy) },
                { key: 'rework', header: 'Retrabalho por operação', cell: (row) => formatNumber(row.reworkPerOperation, 2) },
              ]}
            />
            <p className="mt-3 text-xs text-neutral-500">
              Inventários: {report.data.inventoryRework.countedItems} itens contados, {report.data.inventoryRework.recounts} recontagem(ns).
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {report.data.bySector.map((sector) => (
              <Card key={sector.sector.id} title={`Setor ${sector.sector.code} — ${sector.sector.name}`} actions={!sector.sufficientSample && <Badge tone="warning">Amostra pequena</Badge>}>
                <DescriptionList
                  items={[
                    { label: 'Leituras de conferência', value: sector.attempts },
                    { label: 'Leituras corretas', value: formatPercent(sector.attemptAccuracy) },
                    { label: 'Tempo médio de resolução', value: sector.averageResolutionHours === null ? '—' : `${formatNumber(sector.averageResolutionHours, 1)} h` },
                  ]}
                />
                {Object.keys(sector.errorMix).length > 0 && (
                  <p className="mt-3 text-xs text-neutral-500">Erros: {Object.entries(sector.errorMix).map(([code, value]) => `${CHECK_ERROR[code] ?? code} (${value})`).join(' · ')}</p>
                )}
                {sector.suggestions.map((suggestion) => <p key={suggestion.codes.join()} className="mt-3 rounded-md bg-neutral-50 p-3 text-sm">{suggestion.message}</p>)}
              </Card>
            ))}
          </div>

          {evolution.rows.length > 0 && (
            <Card title="Evolução semanal de leituras corretas por setor (%)">
              <TrendChart data={evolution.rows} xKey="week" formatX={formatBucket} valueSuffix="%" series={evolution.sectors.map((code) => ({ key: code, label: `Setor ${code}` }))} />
            </Card>
          )}

          <Card title="Sugestões de melhoria">
            {report.data.suggestions.length === 0 ? (
              <p className="text-sm text-neutral-500">Sem sugestões: amostra insuficiente ou nenhum padrão relevante de erro no período.</p>
            ) : (
              <ul className="space-y-2">
                {report.data.suggestions.map((suggestion) => <li key={suggestion.codes.join()} className="rounded-md bg-neutral-50 p-3 text-sm">{suggestion.message} <span className="text-xs text-neutral-500">({formatNumber(suggestion.share, 1)}% dos erros)</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
