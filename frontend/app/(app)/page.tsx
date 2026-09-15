'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/display';
import { usePermissions } from '@/hooks/use-session';

/** Página inicial: leva cada perfil direto à tela de trabalho principal. */
export default function HomePage() {
  const router = useRouter();
  const { me, can } = usePermissions();

  useEffect(() => {
    if (!me) return;
    if (can('dashboard.read')) router.replace('/dashboard');
    else if (can('checks.perform')) router.replace('/conferencia');
    else if (can('movements.read.own', 'movements.read.all')) router.replace('/movimentacoes');
    else router.replace('/minha-conta');
  }, [me, can, router]);

  return <Spinner label="Abrindo…" />;
}
