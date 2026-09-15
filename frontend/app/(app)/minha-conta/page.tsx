'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, Card, DescriptionList, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { DataTable } from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';
import { authService } from '@/services';

export default function AccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me } = usePermissions();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authService.sessions });
  const revoke = useMutation({ mutationFn: authService.revokeSession, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }) });
  const logout = useMutation({
    mutationFn: authService.logout,
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  if (!me) return <Spinner />;

  return (
    <>
      <PageHeader title="Minha conta" actions={<Button variant="secondary" loading={logout.isPending} onClick={() => logout.mutate()}>Sair</Button>} />
      <div className="space-y-6">
        <Card actions={<LinkButton href="/trocar-senha" variant="secondary" size="sm">Trocar senha</LinkButton>}>
          <DescriptionList
            items={[
              { label: 'Nome', value: me.user.name },
              { label: 'E-mail', value: me.user.email },
              { label: 'Perfil', value: me.user.role.name },
              { label: 'Verificação em duas etapas', value: me.user.mfaEnabled ? <Badge tone="success">Ativa</Badge> : <Badge>Não configurada</Badge> },
              { label: 'Sessão expira em', value: formatDateTime(me.sessionExpiresAt) },
            ]}
          />
        </Card>

        <Card title="Sessões ativas" description="Encerre sessões que você não reconhece e troque sua senha.">
          {(sessions.error || revoke.error) && <ErrorMessage error={sessions.error ?? revoke.error} />}
          <DataTable
            loading={sessions.isFetching}
            rows={sessions.data?.items}
            rowKey={(row) => row.id}
            columns={[
              { key: 'device', header: 'Navegador', cell: (row) => <span className="line-clamp-2 max-w-md text-xs">{row.userAgent ?? 'Desconhecido'}</span> },
              { key: 'ip', header: 'IP', cell: (row) => <span className="font-mono text-xs">{row.ip ?? '—'}</span> },
              { key: 'created', header: 'Início', cell: (row) => formatDateTime(row.createdAt) },
              { key: 'last', header: 'Última atividade', cell: (row) => formatDateTime(row.lastSeenAt) },
              { key: 'actions', header: '', className: 'text-right', cell: (row) => (row.current ? <Badge tone="info">Sessão atual</Badge> : <Button size="sm" variant="secondary" onClick={() => revoke.mutate(row.id)}>Encerrar</Button>) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
