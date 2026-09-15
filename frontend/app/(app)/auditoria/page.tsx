'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PeriodSelect, startOfDayIso } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { Badge, Card, Notice, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input, Select } from '@/components/ui/form';
import { DataTable, Pagination } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatDateTime } from '@/lib/format';
import { adminService } from '@/services';
import type { AuditRow } from '@/types/api';

const RESULT_TONE = { SUCCESS: 'success', FAILURE: 'warning', DENIED: 'danger' } as const;
const RESULT_LABEL = { SUCCESS: 'Sucesso', FAILURE: 'Falha', DENIED: 'Negado' } as const;

export default function AuditPage() {
  const [days, setDays] = useState('7');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const from = useMemo(() => startOfDayIso(Number(days)), [days]);
  const debouncedAction = useDebouncedValue(action);
  const debouncedEntity = useDebouncedValue(entityId);

  const query = { from, action: debouncedAction, result, entityId: debouncedEntity, page, pageSize: 50 };
  const logs = useQuery({ queryKey: ['audit', query], queryFn: () => adminService.auditLogs(query), placeholderData: keepPreviousData });
  const verify = useMutation({ mutationFn: adminService.verifyAudit });

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registros somente-inserção, encadeados por hash. Nenhum registro pode ser alterado."
        actions={<Button variant="secondary" icon={<ShieldCheck className="size-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>Verificar integridade</Button>}
      />
      <div className="space-y-4">
        {verify.data && (
          <Notice tone={verify.data.valid ? 'success' : 'danger'} title={verify.data.valid ? 'Cadeia de auditoria íntegra' : 'Inconsistência detectada na cadeia de auditoria'}>
            {verify.data.valid ? `${verify.data.checked} registros verificados.` : `Primeiro registro inválido: ${verify.data.firstInvalidId}. Investigue imediatamente — pode indicar alteração direta no banco.`}
          </Notice>
        )}
        {verify.error && <ErrorMessage error={verify.error} />}

        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PeriodSelect value={days} onChange={(value) => { setDays(value); setPage(1); }} />
            <Field label="Ação (prefixo)">{(id) => <Input id={id} placeholder="auth., movements., users." value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} />}</Field>
            <Field label="Resultado">
              {(id) => (
                <Select id={id} value={result} onChange={(event) => { setResult(event.target.value); setPage(1); }}>
                  <option value="">Todos</option>
                  {Object.entries(RESULT_LABEL).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                </Select>
              )}
            </Field>
            <Field label="ID da entidade">{(id) => <Input id={id} value={entityId} onChange={(event) => { setEntityId(event.target.value); setPage(1); }} />}</Field>
          </div>
          {logs.error && <ErrorMessage error={logs.error} />}
          <DataTable
            loading={logs.isFetching}
            rows={logs.data?.items}
            rowKey={(row) => row.id}
            columns={[
              { key: 'date', header: 'Data/Hora', cell: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span> },
              { key: 'actor', header: 'Usuário', cell: (row) => row.actor?.name ?? <span className="text-neutral-400">não identificado</span> },
              { key: 'action', header: 'Ação', cell: (row) => <span className="font-mono text-xs">{row.action}</span> },
              { key: 'entity', header: 'Entidade', cell: (row) => (row.entityType ? <span className="text-xs">{row.entityType}<span className="block font-mono text-neutral-500">{row.entityId?.slice(0, 18)}</span></span> : '—') },
              { key: 'result', header: 'Resultado', cell: (row) => <Badge tone={RESULT_TONE[row.result]}>{RESULT_LABEL[row.result]}</Badge> },
              { key: 'ip', header: 'Origem', cell: (row) => <span className="font-mono text-xs">{row.ip ?? '—'}</span> },
              {
                key: 'details',
                header: '',
                className: 'text-right',
                cell: (row: AuditRow) => (
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? 'Ocultar' : 'Detalhes'}</Button>
                    {expanded === row.id && (
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-left text-xs">
                        {JSON.stringify({ requestId: row.requestId, userAgent: row.userAgent, metadata: row.metadata }, null, 2)}
                      </pre>
                    )}
                  </div>
                ),
              },
            ]}
          />
          {logs.data && <Pagination page={logs.data.page} totalPages={logs.data.totalPages} total={logs.data.total} pageSize={logs.data.pageSize} onChange={setPage} />}
        </Card>
      </div>
    </>
  );
}
