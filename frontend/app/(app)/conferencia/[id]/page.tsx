'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Check, CircleCheck, CircleX, MapPin, Package } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BarcodeScannerButton } from '@/components/barcode-scanner';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, Card, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input, Textarea } from '@/components/ui/form';
import { usePermissions } from '@/hooks/use-session';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber } from '@/lib/format';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { catalogService, movementService } from '@/services';
import type { CheckResult, CheckScan, MovementDetail, MovementItem, ProductSummary } from '@/types/api';

type Step = 0 | 1 | 2 | 3;
const STEPS = ['Produto', 'Quantidade', 'Endereço', 'Confirmação'];

interface Accepted {
  scan: CheckScan;
  variance: boolean;
  productName: string;
  at: string;
}

/** Onde o operador deve estar para conferir: destino na entrada, origem nas demais. */
const checkLocation = (movement: MovementDetail, item: MovementItem) => (movement.type === 'ENTRY' ? item.toLocation : (item.fromLocation ?? item.toLocation));

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2">
      {STEPS.map((label, index) => (
        <li key={label} className="flex flex-col items-center gap-1 text-center">
          <span className={cn('flex size-8 items-center justify-center rounded-full text-sm font-semibold', index < step ? 'bg-emerald-600 text-white' : index === step ? 'bg-neutral-900 text-white' : 'bg-neutral-200 text-neutral-500')}>
            {index < step ? <Check className="size-4" /> : index + 1}
          </span>
          <span className={cn('text-xs', index === step ? 'font-medium text-neutral-900' : 'text-neutral-500')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function CheckPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = usePermissions();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const movement = useQuery({ queryKey: ['movement', id], queryFn: () => movementService.get(id) });
  const [accepted, setAccepted] = useState<Record<string, Accepted>>({});
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [scan, setScan] = useState({ productCode: '', quantity: '', lotCode: '', locationCode: '', destinationCode: '' });
  const [identified, setIdentified] = useState<{ product: ProductSummary | null; error: string | null } | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [varianceReason, setVarianceReason] = useState('');
  const [confirmed, setConfirmed] = useState<MovementDetail | null>(null);

  const items = movement.data?.items ?? [];
  const pendingItems = items.filter((item) => !accepted[item.id]);
  const current = pendingItems.find((item) => item.id === selectedItemId) ?? pendingItems[0] ?? null;
  const lastAccepted = Object.values(accepted).sort((a, b) => b.at.localeCompare(a.at))[0];
  const hasVariance = Object.values(accepted).some((entry) => entry.variance);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step, current?.id]);

  function resetItem() {
    setScan({ productCode: '', quantity: '', lotCode: '', locationCode: '', destinationCode: '' });
    setIdentified(null);
    setResult(null);
    setStep(0);
  }

  const check = useMutation({
    mutationFn: (payload: CheckScan) => movementService.check(id, payload),
    onSuccess: (data) => {
      setResult(data);
      setStep(3);
    },
  });

  const confirm = useMutation({
    mutationFn: () => movementService.confirm(id, Object.values(accepted).map((entry) => entry.scan), hasVariance ? varianceReason.trim() : undefined),
    onSuccess: async (data) => {
      setConfirmed(data);
      queryClient.setQueryData(['movement', id], data);
      await queryClient.invalidateQueries({ queryKey: ['movements'] });
    },
  });

  function buildScan(item: MovementItem): CheckScan {
    return {
      itemId: item.id,
      productCode: scan.productCode.trim(),
      quantity: scan.quantity.trim().replace(',', '.'),
      locationCode: scan.locationCode.trim(),
      ...(scan.lotCode.trim() ? { lotCode: scan.lotCode.trim() } : {}),
      ...(movement.data?.type === 'TRANSFER' && scan.destinationCode.trim() ? { destinationCode: scan.destinationCode.trim() } : {}),
    };
  }

  async function submitStep(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    if (step === 0 && scan.productCode.trim()) {
      try {
        const product = await catalogService.lookup(scan.productCode.trim());
        setIdentified({ product, error: null });
      } catch (error) {
        setIdentified({ product: null, error: error instanceof ApiError ? error.message : 'Código não reconhecido.' });
      }
      setStep(1);
    } else if (step === 1 && Number(scan.quantity.replace(',', '.')) >= 0 && scan.quantity.trim() !== '') {
      setStep(2);
    } else if (step === 2 && scan.locationCode.trim()) {
      check.mutate(buildScan(current));
    }
  }

  function accept(variance: boolean) {
    if (!current) return;
    setAccepted((state) => ({ ...state, [current.id]: { scan: buildScan(current), variance, productName: current.product.name, at: new Date().toISOString() } }));
    setSelectedItemId(null);
    resetItem();
  }

  if (movement.error) return <ErrorMessage error={movement.error} />;
  if (!movement.data || !me) return <Spinner />;
  const data = movement.data;
  const title = `Conferência · MOV-${String(data.number).padStart(4, '0')} (${MOVEMENT_TYPE[data.type]})`;

  if (confirmed) {
    return (
      <>
        <PageHeader title={title} />
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CircleCheck className="size-14 text-emerald-600" aria-hidden />
            <h2 className="text-xl font-semibold">Operação confirmada</h2>
            <p className="text-sm text-neutral-600">O estoque foi atualizado e a movimentação registrada com seu nome em {formatDateTime(confirmed.checkedAt ?? confirmed.confirmedAt)}.</p>
            {confirmed.discrepancies.length > 0 && <Notice tone="warning">Foram registradas {confirmed.discrepancies.length} divergência(s) de quantidade para análise.</Notice>}
            <div className="mt-2 flex gap-2">
              <LinkButton href="/conferencia">Próxima operação</LinkButton>
              <LinkButton href={`/movimentacoes/${confirmed.id}`} variant="secondary">Ver movimentação</LinkButton>
            </div>
          </div>
        </Card>
      </>
    );
  }

  if (data.status !== 'PENDING_CHECK') {
    return (
      <>
        <PageHeader title={title} />
        <Notice tone="info" title="Esta operação não está aguardando conferência">
          <Link href={`/movimentacoes/${data.id}`} className="underline">Ver detalhes da movimentação</Link>
        </Notice>
      </>
    );
  }

  const location = current ? checkLocation(data, current) : null;
  const onlyQuantityErrors = result?.errors.length ? result.errors.every((error) => error.code === 'QUANTITY_MISMATCH') : false;
  const allDone = items.length > 0 && pendingItems.length === 0;

  return (
    <>
      <PageHeader title={title} description="Escaneie o produto e confirme a operação" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {!allDone && current && (
            <Card>
              <Stepper step={step} />

              <div className="mb-5 grid gap-3 rounded-md bg-neutral-50 p-4 text-sm sm:grid-cols-2">
                <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /><span><span className="block text-xs text-neutral-500">{data.type === 'ENTRY' ? 'Guardar em' : 'Retirar de'}</span><span className="font-mono text-base font-semibold">{location?.code ?? '—'}</span>{data.type === 'TRANSFER' && <span className="block text-xs text-neutral-500">Destino: <span className="font-mono">{current.toLocation?.code}</span></span>}</span></p>
                <p className="flex items-start gap-2"><Package className="mt-0.5 size-4 shrink-0" aria-hidden /><span><span className="block text-xs text-neutral-500">Produto</span><span className="font-medium">{current.product.internalCode} · {current.product.name}</span>{current.lot && <span className="block text-xs text-neutral-500">Lote: {current.lot.code}</span>}</span></p>
                <p className="text-xs text-neutral-500 sm:col-span-2">Conte a quantidade física: o sistema compara com o esperado sem exibi-lo (contagem cega).</p>
              </div>

              {step < 3 && (
                <form onSubmit={submitStep} className="space-y-4">
                  {step === 0 && (
                    <div className="flex flex-col items-center gap-4 py-4">
                      <span className="flex size-20 items-center justify-center rounded-full border-2 border-neutral-200"><Barcode className="size-10" aria-hidden /></span>
                      <p className="text-center font-medium">Escaneie o código de barras ou digite o código do produto</p>
                      <Input ref={inputRef} className="h-12 max-w-md text-center text-lg" placeholder="Digite o código ou escaneie…" value={scan.productCode} onChange={(event) => setScan({ ...scan, productCode: event.target.value })} autoComplete="off" />
                      <BarcodeScannerButton variant="ghost" size="sm" label="Ler com a câmera" onDetected={(scanned) => setScan({ ...scan, productCode: scanned })} />
                    </div>
                  )}
                  {step === 1 && (
                    <div className="mx-auto max-w-md space-y-4 py-2">
                      {identified?.product ? (
                        <Notice tone={identified.product.internalCode === current.product.internalCode ? 'success' : 'warning'} title="Produto identificado">
                          {`${identified.product.internalCode} · ${identified.product.name} (${identified.product.unit})`}
                        </Notice>
                      ) : (
                        <Notice tone="warning" title="Código não reconhecido">{identified?.error ?? 'Verifique a etiqueta.'} A leitura será registrada e comparada na confirmação.</Notice>
                      )}
                      <Field label={`Quantidade contada (${current.unit})`} required>
                        {(fieldId) => <Input ref={inputRef} id={fieldId} inputMode="decimal" className="h-12 text-center text-2xl" value={scan.quantity} onChange={(event) => setScan({ ...scan, quantity: event.target.value })} />}
                      </Field>
                      {current.product.tracksLot && (
                        <Field label="Lote" required>{(fieldId) => <Input id={fieldId} value={scan.lotCode} onChange={(event) => setScan({ ...scan, lotCode: event.target.value })} />}</Field>
                      )}
                    </div>
                  )}
                  {step === 2 && (
                    <div className="mx-auto max-w-md space-y-4 py-2">
                      <Field label="Endereço (leia a etiqueta)" required>
                        {(fieldId) => (
                          <div className="flex gap-2">
                            <Input ref={inputRef} id={fieldId} className="h-12 text-center font-mono text-lg" placeholder="A-01-02-03" value={scan.locationCode} onChange={(event) => setScan({ ...scan, locationCode: event.target.value })} autoComplete="off" />
                            <BarcodeScannerButton label="Ler" onDetected={(scanned) => setScan({ ...scan, locationCode: scanned })} />
                          </div>
                        )}
                      </Field>
                      {data.type === 'TRANSFER' && (
                        <Field label="Endereço de destino" required>{(fieldId) => <Input id={fieldId} className="h-12 text-center font-mono text-lg" value={scan.destinationCode} onChange={(event) => setScan({ ...scan, destinationCode: event.target.value })} autoComplete="off" />}</Field>
                      )}
                    </div>
                  )}
                  {check.error && <ErrorMessage error={check.error} />}
                  <div className="flex justify-between gap-2">
                    <Button variant="ghost" onClick={() => (step === 0 ? resetItem() : setStep((step - 1) as Step))} disabled={step === 0}>Voltar</Button>
                    <Button type="submit" size="lg" loading={check.isPending}>{step === 2 ? 'Verificar' : 'Continuar'}</Button>
                  </div>
                </form>
              )}

              {step === 3 && result && (
                <div className="space-y-4">
                  {result.result === 'MATCH' ? (
                    <div className="flex flex-col items-center gap-2 rounded-md bg-emerald-50 p-6 text-center text-emerald-800">
                      <CircleCheck className="size-10" aria-hidden />
                      <p className="text-lg font-semibold">Item conferido corretamente</p>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-md bg-red-50 p-5 text-red-800" role="alert">
                      <p className="flex items-center gap-2 text-lg font-semibold"><CircleX className="size-6" aria-hidden />Conferência com divergência</p>
                      {result.errors.map((error) => <p key={error.code} className="whitespace-pre-line text-sm">{error.message}</p>)}
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {result.result === 'MATCH' ? (
                      <Button size="lg" onClick={() => accept(false)}>Confirmar item</Button>
                    ) : (
                      <>
                        {can('discrepancies.create') && <LinkButton variant="ghost" href={`/divergencias/nova?movementItemId=${current.id}`}>Registrar divergência</LinkButton>}
                        {onlyQuantityErrors && can('movements.confirm_variance') && <Button variant="secondary" onClick={() => accept(true)}>Aceitar diferença (gestor)</Button>}
                        <Button size="lg" onClick={resetItem}>Conferir novamente</Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {allDone && (
            <Card title="Confirmação da operação">
              <p className="mb-4 text-sm text-neutral-600">Todos os itens foram conferidos. O servidor valida tudo novamente antes de alterar o estoque.</p>
              {hasVariance && (
                <div className="mb-4 space-y-3">
                  <Notice tone="warning">Há diferença de quantidade aceita. Uma divergência será registrada para análise.</Notice>
                  <Field label="Justificativa da diferença" required>{(fieldId) => <Textarea id={fieldId} maxLength={500} value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} />}</Field>
                </div>
              )}
              {confirm.error && <div className="mb-4"><ErrorMessage error={confirm.error} title="A operação não foi confirmada" /></div>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => { setAccepted({}); resetItem(); confirm.reset(); }}>Refazer conferência</Button>
                <Button size="lg" variant="success" loading={confirm.isPending} disabled={hasVariance && varianceReason.trim().length < 5} onClick={() => confirm.mutate()}>Confirmar operação</Button>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card title={`Itens (${items.length - pendingItems.length}/${items.length})`}>
            <ul className="space-y-2">
              {items.map((item) => {
                const done = Boolean(accepted[item.id]);
                const isCurrent = current?.id === item.id && !allDone;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={done}
                      onClick={() => { setSelectedItemId(item.id); resetItem(); }}
                      className={cn('w-full rounded-md border px-3 py-2 text-left text-sm', isCurrent ? 'border-neutral-900' : 'border-neutral-200', done && 'bg-neutral-50 text-neutral-500')}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{checkLocation(data, item)?.code}</span>
                        {done ? <Badge tone={accepted[item.id]!.variance ? 'warning' : 'success'}>{accepted[item.id]!.variance ? 'Com diferença' : 'Conferido'}</Badge> : <Badge>Pendente</Badge>}
                      </span>
                      <span className="mt-1 block truncate">{item.product.internalCode} · {item.product.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Última conferência">
            {lastAccepted ? (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-neutral-500">Produto</dt><dd>{lastAccepted.productName}</dd></div>
                <div><dt className="text-xs text-neutral-500">Quantidade</dt><dd>{formatNumber(Number(lastAccepted.scan.quantity))}</dd></div>
                <div><dt className="text-xs text-neutral-500">Endereço</dt><dd className="font-mono">{lastAccepted.scan.locationCode.toUpperCase()}</dd></div>
                <div><dt className="text-xs text-neutral-500">Operador</dt><dd>{me.user.name}</dd></div>
                <div><dt className="text-xs text-neutral-500">Horário</dt><dd>{formatDateTime(lastAccepted.at)}</dd></div>
                <Badge tone={lastAccepted.variance ? 'warning' : 'success'}>{lastAccepted.variance ? 'Com diferença' : 'Concluída'}</Badge>
              </dl>
            ) : (
              <p className="text-sm text-neutral-500">Nenhum item conferido ainda.</p>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
