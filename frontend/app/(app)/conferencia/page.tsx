'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardList, RefreshCw, ScanBarcode } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BarcodeScannerButton } from '@/components/barcode-scanner';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { SearchInput } from '@/components/ui/search-input';
import { DataTable } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatElapsed, formatNumber } from '@/lib/format';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { catalogService, movementService } from '@/services';
import type { MovementListItem, ProductSummary } from '@/types/api';

const STEPS = ['Produto', 'Quantidade', 'Endereço', 'Confirmação'];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex max-w-3xl items-start" aria-label="Etapas da conferência">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const reached = step <= current;
        const last = index === STEPS.length - 1;
        return (
          <li key={label} className={cn('flex flex-col', !last && 'flex-1')} aria-current={step === current ? 'step' : undefined}>
            <div className="flex items-center">
              <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium', reached ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-500')}>
                {step}
              </span>
              {!last && <span className="mx-2 h-px flex-1 bg-neutral-200" aria-hidden />}
            </div>
            <span className={cn('mt-2 text-xs', reached ? 'font-medium text-neutral-900' : 'text-neutral-500')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const movementCode = (number: number) => `MOV-${String(number).padStart(3, '0')}`;

type SearchResult = { kind: 'product'; product: ProductSummary; movements: MovementListItem[] } | { kind: 'none' } | { kind: 'error'; error: unknown };

export default function CheckPage() {
  const router = useRouter();
  const { me, can } = usePermissions();
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);

  const queue = useQuery({
    queryKey: ['movements', 'check-queue'],
    queryFn: () => movementService.list({ status: 'PENDING_CHECK', pageSize: 50 }),
    refetchInterval: 30_000,
  });
  const lastCheck = useQuery({ queryKey: ['movements', 'last-check'], queryFn: () => movementService.list({ status: 'CONFIRMED', pageSize: 1 }) });
  const last = lastCheck.data?.items[0];
  const lastItem = last?.items[0];

  /** Código do produto → operações pendentes com ele; também aceita o número da operação (ex.: MOV-012). */
  async function runSearch(rawCode: string) {
    const value = rawCode.trim();
    if (!value) return;
    setResult(null);
    setSearching(true);
    try {
      let product: ProductSummary | null = null;
      try {
        product = await catalogService.lookup(value);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      if (product) {
        const pending = await movementService.list({ status: 'PENDING_CHECK', productId: product.id, pageSize: 20 });
        const [only] = pending.items;
        if (pending.items.length === 1 && only) {
          router.push(`/conferencia/${only.id}`);
          return;
        }
        setResult({ kind: 'product', product, movements: pending.items });
        return;
      }
      const number = value.replace(/^MOV-?/iu, '');
      if (/^\d+$/u.test(number)) {
        const [found] = (await movementService.list({ number, pageSize: 1 })).items;
        if (found) {
          router.push(`/conferencia/${found.id}`);
          return;
        }
      }
      setResult({ kind: 'none' });
    } catch (error) {
      setResult({ kind: 'error', error });
    } finally {
      setSearching(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    void runSearch(code);
  }

  const matches = result?.kind === 'product' ? result.movements : null;

  return (
    <>
      <PageHeader
        title="Conferência de Produtos"
        description="Escaneie o produto e confirme a operação"
        actions={
          can('inventory.count', 'inventory.manage', 'inventory.approve') && (
            <LinkButton href="/inventarios" variant="secondary" icon={<ClipboardList className="size-4" />}>
              Inventários
            </LinkButton>
          )
        }
      />

      <Stepper current={1} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <form onSubmit={submitSearch} className="flex flex-col items-center px-2 py-8 text-center">
            <span className="flex size-20 items-center justify-center rounded-full border border-neutral-200">
              <ScanBarcode className="size-9 text-neutral-800" strokeWidth={1.5} aria-hidden />
            </span>
            <p className="mt-5 max-w-64 text-[13px] font-medium text-neutral-900">Escaneie o código de barras ou digite o código do produto</p>
            <div className="mt-5 flex w-full max-w-sm gap-2">
              <SearchInput
                className="flex-1"
                aria-label="Código do produto ou número da operação"
                placeholder="Digite o código ou escaneie..."
                autoFocus
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" loading={searching} disabled={!code.trim()}>
                Buscar
              </Button>
            </div>
            <BarcodeScannerButton
              className="mt-3"
              variant="ghost"
              size="sm"
              label="Ler com a câmera"
              onDetected={(scanned) => {
                setCode(scanned);
                void runSearch(scanned);
              }}
            />
            <div className="mt-4 w-full max-w-sm text-left">
              {result?.kind === 'none' && <p className="text-xs text-red-700">Nenhum produto ou operação encontrado com esse código.</p>}
              {result?.kind === 'error' && <ErrorMessage error={result.error} />}
              {matches && matches.length === 0 && result?.kind === 'product' && (
                <p className="text-xs text-neutral-600">Nenhuma operação aguardando conferência com {result.product.name}.</p>
              )}
              {matches && matches.length > 1 && (
                <div className="space-y-1">
                  <p className="text-xs text-neutral-600">Mais de uma operação pendente com este produto. Escolha qual conferir:</p>
                  {matches.map((movement) => (
                    <Link key={movement.id} href={`/conferencia/${movement.id}`} className="flex justify-between rounded-md border border-neutral-200 px-3 py-2 text-[13px] hover:bg-neutral-50">
                      <span>{movementCode(movement.number)} · {MOVEMENT_TYPE[movement.type]}</span>
                      <span className="text-xs text-neutral-500">há {formatElapsed(movement.createdAt)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </form>
        </Card>

        <Card title="Última conferência">
          {lastCheck.isPending && <Spinner />}
          {lastCheck.error && <ErrorMessage error={lastCheck.error} />}
          {lastCheck.data && !last && <p className="text-xs text-neutral-500">Nenhuma conferência concluída ainda.</p>}
          {last && (
            <dl className="space-y-3.5 text-[13px]">
              <div>
                <dt className="text-xs text-neutral-500">Produto</dt>
                <dd className="mt-0.5">
                  {lastItem?.product.name ?? '—'}
                  {last._count.items > 1 && <span className="ml-1 text-xs text-neutral-400">+{last._count.items - 1} itens</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Quantidade</dt>
                <dd className="mt-0.5">{lastItem ? `${formatNumber(lastItem.quantity ?? lastItem.expectedQuantity)} ${lastItem.unit.toLowerCase()}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Endereço</dt>
                <dd className="mt-0.5">{lastItem?.toLocation?.code ?? lastItem?.fromLocation?.code ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Operador</dt>
                <dd className="mt-0.5">{last.checkedBy?.name ?? last.createdBy.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Horário</dt>
                <dd className="mt-0.5">{formatDateTime(last.confirmedAt)}</dd>
              </div>
              <Badge tone="success">Concluída</Badge>
            </dl>
          )}
        </Card>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-neutral-900">Aguardando conferência</h2>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => queue.refetch()} loading={queue.isFetching}>
            Atualizar
          </Button>
        </div>
        {queue.error && <ErrorMessage error={queue.error} />}
        {queue.data && queue.data.items.length === 0 ? (
          <EmptyState title="Nenhuma operação aguardando conferência" description="Novas operações aparecem aqui automaticamente." />
        ) : (
          <DataTable
            loading={queue.isPending}
            rows={queue.data?.items}
            rowKey={(row) => row.id}
            columns={[
              { key: 'number', header: 'ID', cell: (row) => movementCode(row.number) },
              { key: 'type', header: 'Tipo', cell: (row) => MOVEMENT_TYPE[row.type] },
              {
                key: 'product',
                header: 'Produto',
                cell: (row) => (
                  <span>
                    {row.items[0]?.product.name ?? '—'}
                    {row._count.items > 1 && <span className="ml-1 text-xs text-neutral-400">+{row._count.items - 1} itens</span>}
                  </span>
                ),
              },
              {
                key: 'createdBy',
                header: 'Registrada por',
                // Com dupla checagem ativa, quem registrou não pode conferir a própria operação.
                cell: (row) => (row.createdBy.id === me?.user.id ? <Badge tone="warning">Você</Badge> : row.createdBy.name),
              },
              { key: 'waiting', header: 'Aguardando há', cell: (row) => formatElapsed(row.createdAt) },
              {
                key: 'actions',
                header: 'Ações',
                className: 'text-right',
                cell: (row) => (
                  <LinkButton href={`/conferencia/${row.id}`} size="sm" icon={<ScanBarcode className="size-3.5" />}>
                    Conferir
                  </LinkButton>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
