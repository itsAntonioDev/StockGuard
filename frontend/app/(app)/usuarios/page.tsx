'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, Notice, PageHeader } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { DataTable, Pagination } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePermissions } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/format';
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

export default function UsersPage() {
  const { me, can } = usePermissions();
  const queryClient = useQueryClient();
  const canManageAll = can('users.manage');
  const canManage = canManageAll || can('users.manage_operators');
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
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

  return (
    <>
      <PageHeader
        title="Gerenciamento de usuários"
        description={canManageAll ? 'Usuários, perfis e acessos' : 'Operadores e conferentes da sua equipe'}
        actions={canManage && <Button icon={<Plus className="size-4" />} onClick={() => { save.reset(); setForm({ name: '', email: '', roleId: '', sectorId: '', trainingStartedAt: '', active: true }); }}>Novo usuário</Button>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
          <Field label="Buscar">
            {(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                <Input id={id} className="pl-9" placeholder="Nome ou e-mail" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
              </div>
            )}
          </Field>
          <Field label="Perfil">
            {(id) => (
              <Select id={id} value={roleId} onChange={(event) => { setRoleId(event.target.value); setPage(1); }}>
                <option value="">Todos os perfis</option>
                {roles.data?.items.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {(users.error || actionError) && <div className="mb-4"><ErrorMessage error={users.error ?? actionError} /></div>}
        <DataTable
          loading={users.isFetching}
          rows={users.data?.items}
          rowKey={(row) => row.id}
          columns={[
            { key: 'name', header: 'Nome', cell: (row) => <span className="font-medium">{row.name}</span> },
            { key: 'email', header: 'E-mail', cell: (row) => row.email },
            { key: 'role', header: 'Perfil', cell: (row) => row.role.name },
            { key: 'sector', header: 'Setor', cell: (row) => row.sector?.name ?? '—' },
            { key: 'mfa', header: 'MFA', cell: (row) => (row.mfaEnabled ? <Badge tone="success">Ativo</Badge> : <Badge>Não</Badge>) },
            {
              key: 'status',
              header: 'Status',
              cell: (row) =>
                !row.active ? <Badge>Inativo</Badge> : row.lockedUntil && new Date(row.lockedUntil) > new Date() ? <Badge tone="danger">Bloqueado</Badge> : row.mustChangePassword ? <Badge tone="warning">Troca de senha pendente</Badge> : <Badge tone="success">Ativo</Badge>,
            },
            { key: 'last', header: 'Último acesso', cell: (row) => formatDateTime(row.lastLoginAt) },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              cell: (row) =>
                manageable(row) && (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => { save.reset(); setForm({ id: row.id, name: row.name, email: row.email, roleId: row.role.id, sectorId: row.sector?.id ?? '', trainingStartedAt: row.trainingStartedAt?.slice(0, 10) ?? '', active: row.active }); }}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => resetPassword.mutate(row)}>Redefinir senha</Button>
                    {row.lockedUntil && new Date(row.lockedUntil) > new Date() && <Button size="sm" variant="ghost" onClick={() => unlock.mutate(row)}>Desbloquear</Button>}
                    {canManageAll && row.mfaEnabled && <Button size="sm" variant="ghost" onClick={() => resetMfa.mutate(row)}>Redefinir MFA</Button>}
                  </div>
                ),
            },
          ]}
        />
        {users.data && <Pagination page={users.data.page} totalPages={users.data.totalPages} total={users.data.total} pageSize={users.data.pageSize} onChange={setPage} />}
      </Card>

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
