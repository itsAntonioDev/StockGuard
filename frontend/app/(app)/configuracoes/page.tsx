'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Boxes, ChevronRight, DatabaseBackup, Plug, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, Notice, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import { usePermissions } from '@/hooks/use-session';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { adminService } from '@/services';
import type { SettingRow } from '@/types/api';

type SectionKey = 'geral' | 'estoque' | 'notificacoes' | 'seguranca' | 'integracoes' | 'backup';

const SECTIONS: Array<{ key: SectionKey; label: string; icon: LucideIcon; permissions: string[] }> = [
  { key: 'geral', label: 'Geral', icon: Settings, permissions: ['settings.manage'] },
  { key: 'estoque', label: 'Estoque', icon: Boxes, permissions: ['settings.manage'] },
  { key: 'notificacoes', label: 'Notificações', icon: Bell, permissions: ['settings.manage'] },
  { key: 'seguranca', label: 'Segurança', icon: ShieldCheck, permissions: ['settings.manage', 'roles.manage', 'audit.read'] },
  { key: 'integracoes', label: 'Integrações', icon: Plug, permissions: ['settings.manage'] },
  { key: 'backup', label: 'Backup', icon: DatabaseBackup, permissions: ['settings.manage'] },
];

const SECTION_KEYS: Partial<Record<SectionKey, string[]>> = {
  estoque: ['check.requiredTypes', 'check.allowSelfCheck', 'productivity.minSampleSize'],
  notificacoes: ['alerts.pendingHours', 'alerts.invalidAttempts', 'alerts.recurringDiscrepancy'],
};

const SETTING_TITLE: Record<string, string> = {
  'check.requiredTypes': 'Operações que exigem conferência',
  'check.allowSelfCheck': 'Dupla checagem',
  'alerts.pendingHours': 'Alerta de operação pendente',
  'alerts.invalidAttempts': 'Alerta de tentativas inválidas',
  'alerts.recurringDiscrepancy': 'Alerta de divergências recorrentes',
  'productivity.minSampleSize': 'Amostra mínima para indicadores',
};

const TIMEZONES: Record<string, string> = {
  'America/Noronha': '(GMT-02:00) Fernando de Noronha',
  'America/Sao_Paulo': '(GMT-03:00) Brasília',
  'America/Manaus': '(GMT-04:00) Manaus',
  'America/Rio_Branco': '(GMT-05:00) Rio Branco',
  UTC: '(GMT+00:00) UTC',
};

const CHECKABLE_TYPES = ['ENTRY', 'EXIT', 'PICKING', 'TRANSFER'] as const;

function SettingEditor({ setting }: { setting: SettingRow }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<unknown>(setting.value);
  const save = useMutation({
    mutationFn: () => adminService.updateSetting(setting.key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const changed = JSON.stringify(value) !== JSON.stringify(setting.value);
  const record = (value ?? {}) as Record<string, number>;
  const numberField = (key: string, label: string) => (
    <Field label={label}>{(id) => <Input id={id} type="number" min={1} value={record[key] ?? ''} onChange={(event) => setValue({ ...record, [key]: Number(event.target.value) })} />}</Field>
  );

  let editor;
  switch (setting.key) {
    case 'check.requiredTypes': {
      const selected = new Set(value as string[]);
      editor = (
        <div className="flex flex-wrap gap-4">
          {CHECKABLE_TYPES.map((type) => (
            <Checkbox
              key={type}
              label={MOVEMENT_TYPE[type]}
              checked={selected.has(type)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(type);
                else next.delete(type);
                setValue([...next]);
              }}
            />
          ))}
        </div>
      );
      break;
    }
    case 'check.allowSelfCheck':
      editor = <Checkbox label="Permitir que quem registrou a operação também a confira" description="Recomendado manter desativado (segregação de funções)." checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} />;
      break;
    case 'alerts.invalidAttempts':
      editor = <div className="grid max-w-md gap-3 sm:grid-cols-2">{numberField('count', 'Tentativas incorretas')}{numberField('windowMinutes', 'Janela (minutos)')}</div>;
      break;
    case 'alerts.recurringDiscrepancy':
      editor = <div className="grid max-w-md gap-3 sm:grid-cols-2">{numberField('count', 'Divergências do mesmo produto')}{numberField('windowDays', 'Janela (dias)')}</div>;
      break;
    default:
      editor = (
        <div className="max-w-44">
          <Field label={setting.key === 'alerts.pendingHours' ? 'Horas' : 'Operações'}>
            {(id) => <Input id={id} type="number" min={1} value={typeof value === 'number' ? value : ''} onChange={(event) => setValue(Number(event.target.value))} />}
          </Field>
        </div>
      );
  }

  return (
    <div className="border-b border-neutral-100 py-5 first:pt-0 last:border-0 last:pb-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-neutral-900">{SETTING_TITLE[setting.key] ?? setting.key}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{setting.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {setting.isDefault ? <Badge>Padrão</Badge> : <span className="text-xs text-neutral-500">Alterado por {setting.updatedBy?.name ?? '—'} em {formatDateTime(setting.updatedAt)}</span>}
          <Button size="sm" loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {editor}
        {save.error && <ErrorMessage error={save.error} />}
      </div>
    </div>
  );
}

function GeneralForm({ settings }: { settings: SettingRow[] }) {
  const queryClient = useQueryClient();
  const initial = Object.fromEntries(settings.filter((setting) => setting.key.startsWith('general.')).map((setting) => [setting.key, setting.value])) as Record<string, unknown>;
  const [values, setValues] = useState(initial);
  const changedKeys = Object.keys(values).filter((key) => JSON.stringify(values[key]) !== JSON.stringify(initial[key]));
  const set = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      for (const key of changedKeys) await adminService.updateSetting(key, values[key]);
    },
    // ['settings'] também invalida ['settings', 'general'] (preferências de exibição do AppShell).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Nome da empresa">
        {(id) => <Input id={id} maxLength={120} value={String(values['general.companyName'] ?? '')} onChange={(event) => set('general.companyName', event.target.value)} />}
      </Field>
      <Field label="Fuso horário" hint="Usado em datas, relatórios exportados e indicadores diários.">
        {(id) => (
          <Select id={id} value={String(values['general.timezone'] ?? '')} onChange={(event) => set('general.timezone', event.target.value)}>
            {Object.entries(TIMEZONES).map(([zone, label]) => (
              <option key={zone} value={zone}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Formato de data">
          {(id) => (
            <Select id={id} value={String(values['general.dateFormat'] ?? '')} onChange={(event) => set('general.dateFormat', event.target.value)}>
              <option value="DD/MM/AAAA">DD/MM/AAAA</option>
              <option value="AAAA-MM-DD">AAAA-MM-DD</option>
            </Select>
          )}
        </Field>
        <Field label="Formato de hora">
          {(id) => (
            <Select id={id} value={String(values['general.timeFormat'] ?? '')} onChange={(event) => set('general.timeFormat', event.target.value)}>
              <option value="HH:mm">HH:mm (24 horas)</option>
              <option value="hh:mm a">hh:mm (12 horas)</option>
            </Select>
          )}
        </Field>
      </div>
      <Switch label="Manter último filtro ao sair da página" checked={Boolean(values['general.rememberFilters'])} onChange={(checked) => set('general.rememberFilters', checked)} />

      {save.error && <ErrorMessage error={save.error} />}
      {save.isSuccess && changedKeys.length === 0 && <Notice tone="success">Alterações salvas.</Notice>}
      <Button type="submit" loading={save.isPending} disabled={changedKeys.length === 0}>
        Salvar alterações
      </Button>
    </form>
  );
}

function LinkRow({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-4 py-3 hover:bg-neutral-50">
      <span>
        <span className="block text-[13px] font-medium text-neutral-900">{title}</span>
        <span className="block text-xs text-neutral-500">{description}</span>
      </span>
      <ChevronRight className="size-4 text-neutral-400" aria-hidden />
    </Link>
  );
}

export default function SettingsPage() {
  const { can } = usePermissions();
  const canSettings = can('settings.manage');
  const sections = SECTIONS.filter((section) => can(...section.permissions));
  const [selected, setSelected] = useState<SectionKey | null>(null);
  const current = sections.find((section) => section.key === selected) ?? sections[0];
  const settings = useQuery({ queryKey: ['settings'], queryFn: adminService.settings, enabled: canSettings });
  const items = settings.data?.items ?? [];

  const content = () => {
    if (!current) return null;
    if (current.key === 'seguranca') {
      return (
        <Card title="Segurança" description="Controle de acesso, rastreabilidade e proteção das contas.">
          <div className="space-y-2">
            {can('roles.manage') && <LinkRow href="/perfis" title="Perfis e permissões" description="Defina o que cada perfil pode fazer no sistema." />}
            {can('audit.read') && <LinkRow href="/auditoria" title="Auditoria" description="Histórico imutável de ações, com verificação de integridade." />}
            <LinkRow href="/minha-conta" title="Minha conta" description="Senha, verificação em duas etapas (MFA) e sessões ativas." />
          </div>
        </Card>
      );
    }
    if (current.key === 'integracoes') {
      return (
        <Card title="Integrações" description="Conexão do StockGuard com outros sistemas.">
          <div className="space-y-3 text-[13px] text-neutral-700">
            <p>Nenhuma integração externa está configurada.</p>
            <p>
              O sistema expõe uma API REST versionada em <code className="rounded bg-neutral-100 px-1">/api/v1</code>, com o mesmo controle de acesso e auditoria da interface. A
              especificação OpenAPI pode ser gerada no backend com <code className="rounded bg-neutral-100 px-1">npm run openapi</code>. Pontos de extensão (ERP, leitores,
              PDF) estão descritos em <code className="rounded bg-neutral-100 px-1">docs/integracoes.md</code>.
            </p>
          </div>
        </Card>
      );
    }
    if (current.key === 'backup') {
      return (
        <Card title="Backup" description="Cópias de segurança dos dados.">
          <div className="space-y-3 text-[13px] text-neutral-700">
            <p>Os dados ficam no banco PostgreSQL. Backups e restauração são feitos pelo provedor do banco de dados, não pela aplicação.</p>
            <p>O histórico de movimentações e a auditoria são somente-inserção: registros nunca são apagados ou alterados pelo sistema.</p>
          </div>
        </Card>
      );
    }
    if (settings.isPending) return <Spinner />;
    if (settings.error) return <ErrorMessage error={settings.error} />;
    if (current.key === 'geral') {
      return (
        <Card title="Configurações gerais">
          <GeneralForm key={items.map((setting) => setting.updatedAt ?? '').join('|')} settings={items} />
        </Card>
      );
    }
    const keys = SECTION_KEYS[current.key] ?? [];
    return (
      <Card title={current.key === 'estoque' ? 'Estoque e conferência' : 'Notificações e alertas'} description="Toda alteração é validada pelo servidor e registrada na auditoria.">
        {items
          .filter((setting) => keys.includes(setting.key))
          .map((setting) => (
            <SettingEditor key={`${setting.key}-${setting.updatedAt ?? 'default'}`} setting={setting} />
          ))}
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="Configurações do Sistema" description="Personalize as configurações do StockGuard" />
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Seções de configuração">
          <ul className="space-y-0.5">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.key === current?.key;
              return (
                <li key={section.key}>
                  <button
                    type="button"
                    onClick={() => setSelected(section.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn('flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px]', isActive ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50')}
                  >
                    <Icon className="size-4" aria-hidden />
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">{content()}</div>
      </div>
    </>
  );
}
