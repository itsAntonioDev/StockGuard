'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { PERMISSION_MODULE } from '@/lib/labels';
import { adminService } from '@/services';
import type { PermissionRow } from '@/types/api';

/** Permissões que o perfil Administrador nunca perde (espelha a regra do backend). */
const ADMIN_LOCKED = ['users.manage', 'roles.manage', 'audit.read'];

export default function RolesPage() {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: adminService.roles });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: adminService.permissions });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string> | null>(null);

  const selected = roles.data?.items.find((role) => role.id === selectedId) ?? roles.data?.items[0];
  const current = draft ?? new Set(selected?.permissions ?? []);
  const permissionItems = permissions.data?.items;
  const modules = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>();
    for (const permission of permissionItems ?? []) groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
    return [...groups.entries()];
  }, [permissionItems]);

  const changed = selected ? current.size !== selected.permissions.length || selected.permissions.some((code) => !current.has(code)) : false;

  const save = useMutation({
    mutationFn: () => adminService.updateRolePermissions(selected!.id, [...current]),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  if (roles.error || permissions.error) return <ErrorMessage error={roles.error ?? permissions.error} />;
  if (!roles.data || !permissions.data || !selected) return <Spinner />;

  function toggle(code: string, checked: boolean) {
    const next = new Set(current);
    if (checked) next.add(code);
    else next.delete(code);
    setDraft(next);
  }

  return (
    <>
      <PageHeader title="Perfis e permissões" description="Defina o que cada perfil pode fazer. As regras são aplicadas pelo servidor em todas as operações." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card title="Perfis">
          <ul className="space-y-1">
            {roles.data.items.map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  onClick={() => { setSelectedId(role.id); setDraft(null); save.reset(); }}
                  className={cn('w-full rounded-md px-3 py-2 text-left text-sm', role.id === selected.id ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100')}
                >
                  <span className="block font-medium">{role.name}</span>
                  <span className={cn('text-xs', role.id === selected.id ? 'text-neutral-300' : 'text-neutral-500')}>{role.userCount} usuário(s) · {role.permissions.length} permissões</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title={selected.name}
          description={selected.description ?? undefined}
          actions={
            <>
              {changed && <Button variant="secondary" onClick={() => setDraft(null)}>Descartar</Button>}
              <Button loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>Salvar alterações</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Notice tone="warning">Alterações têm efeito imediato para todos os usuários do perfil e ficam registradas na auditoria. Aplique o princípio do menor privilégio.</Notice>
            {save.error && <ErrorMessage error={save.error} />}
            {save.isSuccess && !changed && <Notice tone="success">Permissões atualizadas.</Notice>}
            <div className="grid gap-4 md:grid-cols-2">
              {modules.map(([module, entries]) => (
                <fieldset key={module} className="rounded-md border border-neutral-200 p-4">
                  <legend className="px-1 text-sm font-semibold">{PERMISSION_MODULE[module] ?? module}</legend>
                  <div className="space-y-2">
                    {entries.map((permission) => {
                      const locked = selected.code === 'ADMIN' && ADMIN_LOCKED.includes(permission.code);
                      return (
                        <Checkbox
                          key={permission.code}
                          label={permission.description}
                          description={locked ? `${permission.code} · obrigatória para o Administrador` : permission.code}
                          checked={current.has(permission.code)}
                          disabled={locked}
                          onChange={(event) => toggle(permission.code, event.target.checked)}
                        />
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
