'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { formatDateTime } from '@/lib/format';
import { MOVEMENT_TYPE } from '@/lib/labels';
import { adminService } from '@/services';
import type { SettingRow } from '@/types/api';

const SETTING_TITLE: Record<string, string> = {
  'check.requiredTypes': 'Operações que exigem conferência',
  'check.allowSelfCheck': 'Dupla checagem',
  'alerts.pendingHours': 'Alerta de operação pendente',
  'alerts.invalidAttempts': 'Alerta de tentativas inválidas',
  'alerts.recurringDiscrepancy': 'Alerta de divergências recorrentes',
  'productivity.minSampleSize': 'Amostra mínima para indicadores',
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
            <Checkbox key={type} label={MOVEMENT_TYPE[type]} checked={selected.has(type)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(type); else next.delete(type); setValue([...next]); }} />
          ))}
        </div>
      );
      break;
    }
    case 'check.allowSelfCheck':
      editor = <Checkbox label="Permitir que quem registrou a operação também a confira" description="Recomendado manter desativado (segregação de funções)." checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} />;
      break;
    case 'alerts.invalidAttempts':
      editor = <div className="grid gap-3 sm:grid-cols-2">{numberField('count', 'Tentativas incorretas')}{numberField('windowMinutes', 'Janela (minutos)')}</div>;
      break;
    case 'alerts.recurringDiscrepancy':
      editor = <div className="grid gap-3 sm:grid-cols-2">{numberField('count', 'Divergências do mesmo produto')}{numberField('windowDays', 'Janela (dias)')}</div>;
      break;
    default:
      editor = <div className="max-w-xs"><Field label={setting.key === 'alerts.pendingHours' ? 'Horas' : 'Operações'}>{(id) => <Input id={id} type="number" min={1} value={typeof value === 'number' ? value : ''} onChange={(event) => setValue(Number(event.target.value))} />}</Field></div>;
  }

  return (
    <Card
      title={SETTING_TITLE[setting.key] ?? setting.key}
      description={setting.description}
      actions={
        <>
          {setting.isDefault ? <Badge>Padrão</Badge> : <span className="text-xs text-neutral-500">Alterado por {setting.updatedBy?.name ?? '—'} em {formatDateTime(setting.updatedAt)}</span>}
          <Button size="sm" loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {editor}
        {save.error && <ErrorMessage error={save.error} />}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: adminService.settings });
  return (
    <>
      <PageHeader title="Configurações do sistema" description="Parâmetros operacionais. Toda alteração é validada pelo servidor e auditada." />
      {settings.error && <ErrorMessage error={settings.error} />}
      {settings.isPending && <Spinner />}
      <div className="space-y-4">
        {settings.data?.items.map((setting) => <SettingEditor key={`${setting.key}-${setting.updatedAt ?? 'default'}`} setting={setting} />)}
      </div>
    </>
  );
}
