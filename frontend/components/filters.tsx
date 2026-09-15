'use client';

import { Field, Select } from '@/components/ui/form';

export const PERIOD_OPTIONS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '365', label: 'Últimos 12 meses' },
];

/** Início do dia, N dias atrás (valor estável durante o dia → cache de consultas não invalida a cada render). */
export function startOfDayIso(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days + 1);
  return date.toISOString();
}

export function PeriodSelect({ value, onChange, label = 'Período' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function EnumSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  allLabel = 'Todos',
}: {
  label: string;
  value: T | '';
  onChange: (value: T | '') => void;
  options: Record<T, string>;
  allLabel?: string;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value as T | '')}>
          <option value="">{allLabel}</option>
          {(Object.entries(options) as Array<[T, string]>).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
