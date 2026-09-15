'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ReasonModal } from '@/components/reason-modal';
import { Button } from '@/components/ui/button';
import { Card, DescriptionList, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Select, Textarea } from '@/components/ui/form';
import { DiscrepancyStatusBadge } from '@/components/ui/status';
import { usePermissions } from '@/hooks/use-session';
import { downloadFile } from '@/lib/api';
import { formatBytes, formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import { DISCREPANCY_ORIGIN, DISCREPANCY_STATUS, DISCREPANCY_TYPE, MOVEMENT_TYPE, PROBABLE_CAUSE } from '@/lib/labels';
import { adminService, discrepancyService } from '@/services';
import type { DiscrepancyDetail, ProbableCause } from '@/types/api';

const FINAL = ['CORRECTED', 'CONFIRMED', 'DISCARDED'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const ACTION_LABEL: Record<DiscrepancyDetail['actions'][number]['kind'], string> = {
  CREATED: 'Registro',
  COMMENT: 'Comentário',
  STATUS_CHANGE: 'Mudança de status',
  ASSIGNMENT: 'Atribuição',
  CAUSE_UPDATE: 'Causa provável',
  EVIDENCE_ADDED: 'Evidência anexada',
};

export default function DiscrepancyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = usePermissions();
  const queryClient = useQueryClient();
  const [analysis, setAnalysis] = useState({ probableCause: '' as ProbableCause | '', correctiveAction: '', note: '' });
  const [comment, setComment] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const discrepancy = useQuery({ queryKey: ['discrepancy', id], queryFn: () => discrepancyService.get(id) });
  const canManage = can('discrepancies.manage');
  const analysts = useQuery({ queryKey: ['users', 'active'], queryFn: () => adminService.users({ active: 'true', pageSize: 100 }), enabled: canManage && can('users.read') });

  const onUpdated = async (updated: DiscrepancyDetail) => {
    queryClient.setQueryData(['discrepancy', id], updated);
    await queryClient.invalidateQueries({ queryKey: ['discrepancies'] });
  };
  const changeStatus = useMutation({ mutationFn: (body: Record<string, unknown>) => discrepancyService.changeStatus(id, body), onSuccess: async (updated) => { setDiscarding(false); setAnalysis({ probableCause: '', correctiveAction: '', note: '' }); await onUpdated(updated); } });
  const assign = useMutation({ mutationFn: (userId: string | null) => discrepancyService.assign(id, userId), onSuccess: onUpdated });
  const addComment = useMutation({ mutationFn: () => discrepancyService.comment(id, comment.trim()), onSuccess: async (updated) => { setComment(''); await onUpdated(updated); } });
  const upload = useMutation({ mutationFn: (file: File) => discrepancyService.uploadEvidence(id, file), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discrepancy', id] }) });
  const download = useMutation({ mutationFn: (evidence: { id: string; originalName: string }) => downloadFile(`/discrepancies/${id}/evidences/${evidence.id}`, {}, evidence.originalName) });

  if (discrepancy.error) return <ErrorMessage error={discrepancy.error} />;
  if (!discrepancy.data || !me) return <Spinner />;
  const data = discrepancy.data;
  const isFinal = FINAL.includes(data.status);
  const canContribute = can('discrepancies.create', 'discrepancies.manage');

  function selectFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setFileError('Arquivo maior que 5 MB.');
    if (!ACCEPTED_TYPES.includes(file.type)) return setFileError('Envie JPG, PNG, WEBP ou PDF.');
    upload.mutate(file);
  }

  return (
    <>
      <PageHeader title={`DIV-${String(data.number).padStart(4, '0')} · ${DISCREPANCY_TYPE[data.type]}`} description={`${DISCREPANCY_ORIGIN[data.origin]} · registrada em ${formatDateTime(data.createdAt)}`} actions={<DiscrepancyStatusBadge status={data.status} />} />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <DescriptionList
              items={[
                { label: 'Produto', value: data.product ? <Link className="underline" href={`/produtos/${data.product.id}`}>{data.product.internalCode} · {data.product.name}</Link> : '—' },
                { label: 'Lote', value: data.lot?.code ?? '—' },
                { label: 'Endereço', value: data.location ? <span className="font-mono">{data.location.code}</span> : '—' },
                { label: 'Setor', value: data.location?.sector.name ?? '—' },
                { label: 'Operação', value: data.movement ? <Link className="underline" href={`/movimentacoes/${data.movement.id}`}>MOV-{String(data.movement.number).padStart(4, '0')} · {MOVEMENT_TYPE[data.movement.type]}</Link> : '—' },
                { label: 'Quantidade esperada / encontrada', value: `${formatNumber(data.expectedQuantity)} / ${formatNumber(data.foundQuantity)}` },
                { label: 'Códigos esperado / encontrado', value: data.expectedCode || data.foundCode ? `${data.expectedCode ?? '—'} / ${data.foundCode ?? '—'}` : '—' },
                { label: 'Valor estimado', value: data.estimatedValue === null ? 'Sem custo cadastrado' : formatCurrency(data.estimatedValue) },
                { label: 'Registrada por', value: data.reportedBy.name },
                { label: 'Executante da operação (contexto)', value: data.operationUser?.name ?? '—' },
                { label: 'Responsável pela análise', value: data.assignedTo?.name ?? '—' },
                { label: 'Causa provável', value: PROBABLE_CAUSE[data.probableCause] },
                { label: 'Ação corretiva', value: data.correctiveAction ?? '—' },
                { label: 'Resolvida em', value: formatDateTime(data.resolvedAt) },
              ]}
            />
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <p className="text-xs font-medium text-neutral-500">Descrição</p>
              <p className="mt-1 whitespace-pre-line text-sm">{data.description}</p>
            </div>
          </Card>

          {canManage && !isFinal && (
            <Card title="Análise" description="A causa provável é definida por quem analisa — o sistema nunca a atribui automaticamente.">
              {data.status === 'OPEN' ? (
                <div className="flex flex-wrap gap-2">
                  <Button loading={changeStatus.isPending} onClick={() => changeStatus.mutate({ status: 'IN_ANALYSIS' })}>Iniciar análise</Button>
                  <Button variant="secondary" onClick={() => setDiscarding(true)}>Descartar</Button>
                </div>
              ) : (
                <div className="grid gap-4">
                  <Field label="Causa provável" required>
                    {(fieldId) => (
                      <Select id={fieldId} value={analysis.probableCause} onChange={(event) => setAnalysis({ ...analysis, probableCause: event.target.value as ProbableCause })}>
                        <option value="">Selecione</option>
                        {(Object.keys(PROBABLE_CAUSE) as ProbableCause[]).filter((cause) => cause !== 'NOT_DETERMINED').map((cause) => <option key={cause} value={cause}>{PROBABLE_CAUSE[cause]}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Ação corretiva" required hint="O que foi feito para corrigir e evitar a repetição (processo, sinalização, treinamento…).">
                    {(fieldId) => <Textarea id={fieldId} maxLength={2000} value={analysis.correctiveAction} onChange={(event) => setAnalysis({ ...analysis, correctiveAction: event.target.value })} />}
                  </Field>
                  <Field label="Observação">{(fieldId) => <Textarea id={fieldId} maxLength={2000} value={analysis.note} onChange={(event) => setAnalysis({ ...analysis, note: event.target.value })} />}</Field>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={() => setDiscarding(true)}>Descartar</Button>
                    <Button variant="secondary" loading={changeStatus.isPending} disabled={!analysis.probableCause || analysis.correctiveAction.trim().length < 2} onClick={() => changeStatus.mutate({ status: 'CONFIRMED', ...analysis })}>
                      Confirmar divergência
                    </Button>
                    <Button loading={changeStatus.isPending} disabled={!analysis.probableCause || analysis.correctiveAction.trim().length < 2} onClick={() => changeStatus.mutate({ status: 'CORRECTED', ...analysis })}>
                      Marcar como corrigida
                    </Button>
                  </div>
                  <p className="text-xs text-neutral-500">Corrigida: a situação foi regularizada. Confirmada: a divergência é real (ex.: perda) e foi tratada.</p>
                </div>
              )}
              {changeStatus.error && <div className="mt-4"><ErrorMessage error={changeStatus.error} /></div>}
            </Card>
          )}

          <Card title="Histórico">
            <ol className="space-y-4">
              {data.actions.map((action) => (
                <li key={action.id} className="border-l-2 border-neutral-200 pl-4">
                  <p className="text-sm font-medium">
                    {ACTION_LABEL[action.kind]}
                    {action.toStatus && action.kind === 'STATUS_CHANGE' && `: ${action.fromStatus ? `${DISCREPANCY_STATUS[action.fromStatus]} → ` : ''}${DISCREPANCY_STATUS[action.toStatus]}`}
                  </p>
                  <p className="text-xs text-neutral-500">{action.user.name} · {formatDateTime(action.createdAt)}</p>
                  {action.note && <p className="mt-1 whitespace-pre-line text-sm text-neutral-700">{action.note}</p>}
                </li>
              ))}
            </ol>
            {canContribute && (
              <div className="mt-5 space-y-2 border-t border-neutral-100 pt-4">
                <Field label="Adicionar comentário" hint="Explique o contexto — inclusive após a análise.">{(fieldId) => <Textarea id={fieldId} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />}</Field>
                {addComment.error && <ErrorMessage error={addComment.error} />}
                <div className="flex justify-end"><Button size="sm" loading={addComment.isPending} disabled={comment.trim().length < 2} onClick={() => addComment.mutate()}>Comentar</Button></div>
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          {canManage && !isFinal && (
            <Card title="Responsável">
              <div className="space-y-3">
                {analysts.data && (
                  <Select aria-label="Responsável pela análise" value={data.assignedTo?.id ?? ''} onChange={(event) => assign.mutate(event.target.value || null)}>
                    <option value="">Sem responsável</option>
                    {analysts.data.items.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.role.name})</option>)}
                  </Select>
                )}
                {data.assignedTo?.id !== me.user.id && <Button variant="secondary" className="w-full" loading={assign.isPending} onClick={() => assign.mutate(me.user.id)}>Assumir análise</Button>}
                {assign.error && <ErrorMessage error={assign.error} />}
              </div>
            </Card>
          )}

          <Card title="Evidências">
            {data.evidences.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma evidência anexada.</p>
            ) : (
              <ul className="space-y-2">
                {data.evidences.map((evidence) => (
                  <li key={evidence.id} className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{evidence.originalName}</span>
                      <span className="text-xs text-neutral-500">{formatBytes(evidence.sizeBytes)} · {evidence.uploadedBy.name}</span>
                    </span>
                    <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => download.mutate(evidence)} aria-label={`Baixar ${evidence.originalName}`} />
                  </li>
                ))}
              </ul>
            )}
            {canContribute && !isFinal && (
              <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-600 hover:bg-neutral-50">
                <Upload className="size-4" aria-hidden />
                {upload.isPending ? 'Enviando…' : 'Anexar foto ou PDF (até 5 MB)'}
                <input type="file" className="sr-only" accept={ACCEPTED_TYPES.join(',')} disabled={upload.isPending} onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
            )}
            {fileError && <p className="mt-2 text-xs text-red-700">{fileError}</p>}
            {(upload.error || download.error) && <div className="mt-2"><ErrorMessage error={upload.error ?? download.error} /></div>}
          </Card>

          {isFinal && <Notice tone="neutral">Divergência finalizada: os dados não podem mais ser alterados. Comentários continuam permitidos.</Notice>}
        </aside>
      </div>

      <ReasonModal open={discarding} title="Descartar divergência" description="Use quando o registro não se confirmou (ex.: leitura equivocada já corrigida)." confirmLabel="Descartar" pending={changeStatus.isPending} error={changeStatus.error} onClose={() => setDiscarding(false)} onConfirm={(note) => changeStatus.mutate({ status: 'DISCARDED', note })} />
    </>
  );
}
