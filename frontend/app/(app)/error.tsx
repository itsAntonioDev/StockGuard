'use client';

import { Button } from '@/components/ui/button';

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">Algo deu errado nesta tela</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Nenhuma operação foi confirmada por causa deste erro. Tente novamente; se persistir, informe o código abaixo ao suporte.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-neutral-400">{error.digest}</p>}
      <Button className="mt-6" onClick={() => retry()}>
        Tentar novamente
      </Button>
    </div>
  );
}
