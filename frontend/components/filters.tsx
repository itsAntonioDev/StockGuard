'use client';

import { Field, Select } from '@/components/ui/form';
import { cn } from '@/lib/cn';

export const PERIOD_OPTIONS = [
  { value: '1', label: 'Hoje' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '365', label: 'Últimos 12 meses' },
];

const FILTER_WIDTH = 'w-full sm:w-44';

/** Início do dia, N dias atrás (valor estável durante o dia → cache de consultas não invalida a cada render). */
export function startOfDayIso(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days + 1);
  return date.toISOString();
}

/** Início do período escolhido; vazio = sem limite de data. */
export function periodStart(days: string): string | undefined {
  return days ? startOfDayIso(Number(days)) : undefined;
}

export function PeriodSelect({
  value,
  onChange,
  label = 'Período',
  className,
  allowAll = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  allowAll?: boolean;
}) {
  return (
    <Field label={label} className={cn(FILTER_WIDTH, className)}>
      {(id) => (
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {allowAll && <option value="">Todo o período</option>}
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
  className,
}: {
  label: string;
  value: T | '';
  onChange: (value: T | '') => void;
  options: Record<T, string>;
  allLabel?: string;
  className?: string;
}) {
  return (
    <Field label={label} className={cn(FILTER_WIDTH, className)}>
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

/** Seleção a partir de uma lista carregada da API (produto, operador, setor). */
export function OptionSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'Todos',
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
  className?: string;
}) {
  return (
    <Field label={label} className={cn(FILTER_WIDTH, className)}>
      {(id) => (
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
