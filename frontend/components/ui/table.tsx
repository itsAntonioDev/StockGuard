import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState, Spinner } from './display';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  className?: string;
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[] | undefined;
  rowKey: (row: Row) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataTable<Row>({ columns, rows, rowKey, loading, emptyTitle = 'Nenhum registro encontrado', emptyDescription }: DataTableProps<Row>) {
  if (loading && !rows) return <Spinner />;
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn('px-3 py-2.5 font-medium', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-3 align-middle text-neutral-800', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onChange }: { page: number; totalPages: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
      <span>
        Mostrando {first} a {last} de {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex size-8 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 font-medium text-neutral-700">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex size-8 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40"
          aria-label="Próxima página"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
