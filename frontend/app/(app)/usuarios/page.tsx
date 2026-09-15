'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus } from 'lucide-react';
import { useState } from 'react';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { Button } from '@/components/ui/button';
import { Badge, Notice, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { SearchInput } from '@/components/ui/search-input';
import { DataTable, Pagination } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useRememberedState } from '@/hooks/use-remembered-state';
import { usePermissions } from '@/hooks/use-session';
import { adminService, locationService } from '@/services';
import type { UserRow } from '@/types/api';

interface UserForm {
  id?: string;
  name: string;
  email: string;
  roleId: string;
  sectorId: string;
  trainingStartedAt: string;
  active: boolean;
}

const OPERATIONAL = ['OPERATOR', 'CHECKER'];

const isLocked = (user: UserRow) => Boolean(user.lockedUntil && new Date(user.lockedUntil) > new Date());

function UserStatus({ user }: { user: UserRow }) {
  if (!user.active) return <Badge>Inativo</Badge>;
  if (isLocked(user)) return <Badge tone="danger">Bloqueado</Badge>;
  if (user.mustChangePassword) return <Badge tone="warning">Troca de senha pendente</Badge>;
  return <Badge tone="success">Ativo</Badge>;
}

export default function UsersPage() {
  const { me, can } = usePermissions();
  const queryClient = useQueryClient();
  const canManageAll = can('users.manage');
  const canManage = canManageAll || can('users.manage_operators');
  const [search, setSearch] = useRememberedState('usuarios:busca', '');
  const [roleId, setRoleId] = useRememberedState('usuarios:perfil', '');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<UserForm | null>(null);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
  const debounced = useDebouncedValue(search);

  const query = { search: debounced, roleId, page, pageSize: 20 };
  const users = useQuery({ queryKey: ['users', query], queryFn: () => adminService.users(query), placeholderData: keepPreviousData });
  const roles = useQuery({ queryKey: ['roles'], queryFn: adminService.roles });
  const sectors = useQuery({ queryKey: ['sectors'], queryFn: () => locationService.sectors(), enabled: can('locations.read') });
  const assignableRoles = (roles.data?.items ?? []).filter((role) => canManageAll || OPERATIONAL.includes(role.code));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const save = useMutation({
    mutationFn: async (value: UserForm) => {
      const common = { name: value.name.trim(), roleId: value.roleId, sectorId: value.sectorId || null, trainingStartedAt: value.trainingStartedAt || null };
      if (value.id) {
        await adminService.updateUser(value.id, { ...common, active: value.active });
        return null;
      }
      const { sectorId, trainingStartedAt, ...rest } = common;
      const created = await adminService.createUser({ ...rest, email: value.email.trim(), ...(sectorId ? { sectorId } : {}), ...(trainingStartedAt ? { trainingStartedAt } : {}) });
      return { name: created.user.name, password: created.temporaryPassword };
    },
    onSuccess: async (result) => {
      setForm(null);
      if (result) setSecret(result);
      await refresh();
    },
  });

  const resetPassword = useMutation({ mutationFn: (user: UserRow) => adminService.resetPassword(user.id).then((result) => ({ name: user.name, password: result.temporaryPassword })), onSuccess: async (result) => { setSecret(result); await refresh(); } });
  const unlock = useMutation({ mutationFn: (user: UserRow) => adminService.unlock(user.id), onSuccess: refresh });
  const resetMfa = useMutation({ mutationFn: (user: UserRow) => adminService.resetMfa(user.id), onSuccess: refresh });
  const actionError = resetPassword.error ?? unlock.error ?? resetMfa.error;

  const manageable = (user: UserRow) => canManage && user.id !== me?.user.id && (canManageAll || OPERATIONAL.includes(user.role.code));
  const openEdit = (row: UserRow) => {
    save.reset();
    setForm({ id: row.id, name: row.name, email: row.email, roleId: row.role.id, sectorId: row.sector?.id ?? '', trainingStartedAt: row.trainingStartedAt?.slice(0, 10) ?? '', active: row.active });
  };

  return (
    <>
      <PageHeader
        title="Gerenciamento de Usuários"
        description={canManageAll ? 'Configure os usuários e suas permissões' : 'Operadores e conferentes da sua equipe'}
        actions={canManage && <Button icon={<Plus className="size-4" />} onClick={() => { save.reset(); setForm({ name: '', email: '', roleId: '', sectorId: '', trainingStartedAt: '', active: true }); }}>Novo usuário</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput className="w-full sm:w-80" aria-label="Buscar usuários" placeholder="Buscar por nome, e-mail ou usuário..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select className="w-full sm:w-44" aria-label="Perfil" value={roleId} onChange={(event) => { setRoleId(event.target.value); setPage(1); }}>
          <option value="">Todos os perfis</option>
          {roles.data?.items.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </Select>
      </div>

      {(users.error || actionError) && <div className="mb-4"><ErrorMessage error={users.error ?? actionError} /></div>}
      <DataTable
        loading={users.isFetching}
        rows={users.data?.items}
        rowKey={(row) => row.id}
        emptyTitle="Nenhum usuário encontrado"
        columns={[
          { key: 'name', header: 'Nome', cell: (row) => row.name },
          { key: 'email', header: 'Usuário', cell: (row) => <span className="text-neutral-600">{row.email}</span> },
          { key: 'role', header: 'Perfil', cell: (row) => row.role.name },
          { key: 'sector', header: 'Setor', cell: (row) => row.sector?.name ?? '—' },
          { key: 'status', header: 'Status', cell: (row) => <UserStatus user={row} /> },
          {
            key: 'actions',
            header: 'Ações',
            className: 'w-16 text-right',
            cell: (row) =>
              manageable(row) ? (
                <ActionsMenu
                  items={[
                    { label: 'Editar', onClick: () => openEdit(row) },
                    { label: 'Redefinir senha', onClick: () => resetPassword.mutate(row) },
                    { label: 'Desbloquear', onClick: () => unlock.mutate(row), hidden: !isLocked(row) },
                    { label: 'Redefinir MFA', onClick: () => resetMfa.mutate(row), hidden: !(canManageAll && row.mfaEnabled), tone: 'danger' },
                  ]}
                />
              ) : null,
          },
        ]}
      />
      {users.data && <Pagination page={users.data.page} totalPages={users.data.totalPages} total={users.data.total} pageSize={users.data.pageSize} onChange={setPage} itemLabel="usuários" />}

      {form && (
        <Modal
          open
          title={form.id ? 'Editar usuário' : 'Novo usuário'}
          description={form.id ? 'Mudar o perfil ou desativar encerra as sessões abertas do usuário.' : 'Uma senha temporária será gerada e exibida uma única vez.'}
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button loading={save.isPending} disabled={form.name.trim().length < 3 || !form.roleId || (!form.id && !form.email)} onClick={() => save.mutate(form)}>Salvar</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">{(id) => <Input id={id} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
            <Field label="E-mail" required className="sm:col-span-2">{(id) => <Input id={id} type="email" maxLength={254} value={form.email} disabled={Boolean(form.id)} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
            <Field label="Perfil" required>
              {(id) => (
                <Select id={id} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>
                  <option value="">Selecione</option>
                  {assignableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Setor">
              {(id) => (
                <Select id={id} value={form.sectorId} onChange={(event) => setForm({ ...form, sectorId: event.target.value })}>
                  <option value="">Sem setor</option>
                  {sectors.data?.items.filter((sector) => sector.active).map((sector) => <option key={sector.id} value={sector.id}>{sector.warehouse.code} · {sector.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Início do treinamento" hint="Contexto para indicadores de produtividade.">{(id) => <Input id={id} type="date" value={form.trainingStartedAt} onChange={(event) => setForm({ ...form, trainingStartedAt: event.target.value })} />}</Field>
            {form.id && <Checkbox className="self-end pb-2" label="Usuário ativo" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />}
            {save.error && <div className="sm:col-span-2"><ErrorMessage error={save.error} /></div>}
          </div>
        </Modal>
      )}

      {secret && (
        <Modal open title="Senha temporária" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Entendi, já anotei</Button>}>
          <div className="space-y-4">
            <Notice tone="warning">Esta senha não será exibida novamente. Entregue-a pessoalmente a {secret.name}; a troca será exigida no primeiro acesso.</Notice>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-md bg-neutral-100 px-3 py-2 font-mono text-lg">{secret.password}</code>
              <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(secret.password)}>Copiar</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
