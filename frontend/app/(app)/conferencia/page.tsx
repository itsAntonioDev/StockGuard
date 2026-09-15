'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ScanBarcode } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/form';
import { usePermissions } from '@/hooks/use-session';
import { formatElapsed } from '@/lib/format';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { movementService } from '@/services';

export default function CheckQueuePage() {
  const router = useRouter();
  const { me } = usePermissions();
  const [number, setNumber] = useState('');
  const [notFound, setNotFound] = useState(false);

  const queue = useQuery({
    queryKey: ['movements', 'check-queue'],
    queryFn: () => movementService.list({ status: 'PENDING_CHECK', pageSize: 50 }),
    refetchInterval: 30_000,
  });

  async function openByNumber(event: FormEvent) {
    event.preventDefault();
    setNotFound(false);
    const result = await movementService.list({ number: number.trim(), pageSize: 1 });
    const found = result.items[0];
    if (found) router.push(`/conferencia/${found.id}`);
    else setNotFound(true);
  }

  return (
    <>
      <PageHeader
        title="Conferência de produtos"
        description="Selecione uma operação pendente para conferir"
        actions={<Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => queue.refetch()} loading={queue.isFetching}>Atualizar</Button>}
      />

      <form onSubmit={openByNumber} className="mb-6 flex max-w-md gap-2">
        <Input inputMode="numeric" placeholder="Número da operação" value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/gu, ''))} aria-label="Número da operação" />
        <Button type="submit" disabled={!number}>Abrir</Button>
      </form>
      {notFound && <p className="-mt-4 mb-6 text-sm text-red-700">Operação não encontrada ou não disponível para você.</p>}

      {queue.error && <ErrorMessage error={queue.error} />}
      {queue.isPending && <Spinner />}
      {queue.data && queue.data.items.length === 0 && <EmptyState title="Nenhuma operação aguardando conferência" description="Novas operações aparecem aqui automaticamente." />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {queue.data?.items.map((movement) => {
          const ownMovement = movement.createdBy.id === me?.user.id;
          return (
            <article key={movement.id} className="flex flex-col justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-5">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-lg font-semibold">MOV-{String(movement.number).padStart(4, '0')}</span>
                  <Badge>{MOVEMENT_TYPE[movement.type]}</Badge>
                </div>
                <p className="mt-2 text-sm text-neutral-600">{movement._count.items} item(ns) · {movement.warehouse.code}</p>
                <p className="text-xs text-neutral-500">Registrada por {movement.createdBy.name} há {formatElapsed(movement.createdAt)}</p>
                {movement.referenceDoc && <p className="text-xs text-neutral-500">Documento: {movement.referenceDoc}</p>}
                {ownMovement && <p className="mt-2 text-xs text-amber-700">Registrada por você — com dupla checagem ativa, outra pessoa deve conferir.</p>}
              </div>
              <LinkButton href={`/conferencia/${movement.id}`} size="lg" icon={<ScanBarcode className="size-5" />}>Conferir</LinkButton>
            </article>
          );
        })}
      </div>
    </>
  );
}
