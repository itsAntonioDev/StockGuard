'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { EnumSelect } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { SeverityBadge } from '@/components/ui/status';
import { Pagination } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';
import { ALERT_SEVERITY, ALERT_STATUS, ALERT_TYPE } from '@/lib/labels';
import { alertService } from '@/services';
import type { AlertSeverity, AlertStatus, AlertType } from '@/types/api';

export default function AlertsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AlertStatus | ''>('');
  const [severity, setSeverity] = useState<AlertSeverity | ''>('');
  const [type, setType] = useState<AlertType | ''>('');
  const [page, setPage] = useState(1);

  const query = { status, severity, type, page, pageSize: 20 };
  const alerts = useQuery({ queryKey: ['alerts', query], queryFn: () => alertService.list(query), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts'] });
  const acknowledge = useMutation({ mutationFn: alertService.acknowledge, onSuccess: refresh });
  const resolve = useMutation({ mutationFn: alertService.resolve, onSuccess: refresh });

  return (
    <>
      <PageHeader title="Alertas" description="Situações que exigem atenção. Alertas repetidos são agrupados." />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <EnumSelect label="Status" value={status} options={ALERT_STATUS} allLabel="Não resolvidos" onChange={(value) => { setStatus(value); setPage(1); }} />
          <EnumSelect label="Severidade" value={severity} options={ALERT_SEVERITY} onChange={(value) => { setSeverity(value); setPage(1); }} />
          <EnumSelect label="Tipo" value={type} options={ALERT_TYPE} onChange={(value) => { setType(value); setPage(1); }} />
        </div>
        {(alerts.error || acknowledge.error || resolve.error) && <ErrorMessage error={alerts.error ?? acknowledge.error ?? resolve.error} />}
        {alerts.isPending && <Spinner />}
        {alerts.data?.items.length === 0 && <EmptyState title="Nenhum alerta" description="Tudo em ordem para os filtros selecionados." />}
        <ul className="space-y-3">
          {alerts.data?.items.map((alert) => (
            <li key={alert.id} className="rounded-md border border-neutral-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={alert.severity} />
                    <Badge>{ALERT_TYPE[alert.type]}</Badge>
                    {alert.occurrences > 1 && <Badge tone="info">{alert.occurrences} ocorrências</Badge>}
                    {alert.status !== 'OPEN' && <Badge tone="neutral">{ALERT_STATUS[alert.status]}</Badge>}
                  </div>
                  <p className="mt-2 font-medium">{alert.title}</p>
                  <p className="mt-1 text-sm text-neutral-600">{alert.message}</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                    <span>Última ocorrência: {formatDateTime(alert.lastOccurredAt)}</span>
                    {alert.product && <Link className="underline" href={`/produtos/${alert.product.id}`}>{alert.product.internalCode}</Link>}
                    {alert.location && <span className="font-mono">{alert.location.code}</span>}
                    {alert.movement && <Link className="underline" href={`/movimentacoes/${alert.movement.id}`}>MOV-{String(alert.movement.number).padStart(4, '0')}</Link>}
                    {alert.acknowledgedBy && <span>Reconhecido por {alert.acknowledgedBy.name}</span>}
                  </p>
                </div>
                {can('alerts.manage') && alert.status !== 'RESOLVED' && (
                  <div className="flex gap-2">
                    {alert.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => acknowledge.mutate(alert.id)}>Reconhecer</Button>}
                    <Button size="sm" onClick={() => resolve.mutate(alert.id)}>Resolver</Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {alerts.data && <Pagination page={alerts.data.page} totalPages={alerts.data.totalPages} total={alerts.data.total} pageSize={alerts.data.pageSize} onChange={setPage} />}
      </Card>
    </>
  );
}
