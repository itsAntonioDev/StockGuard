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
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-neutral-200">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn('px-3 py-2.5 text-xs font-medium text-neutral-500', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/70">
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

/** Números visíveis: primeiras páginas, reticências e a última (ex.: 1 2 3 4 5 … 12). */
function pageNumbers(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const start = Math.max(1, Math.min(page - 2, totalPages - 5));
  const numbers: Array<number | 'gap'> = Array.from({ length: 5 }, (_, index) => start + index);
  if (start > 1) numbers.unshift(1, 'gap');
  if (start + 4 < totalPages) numbers.push('gap', totalPages);
  return numbers;
}

const PAGE_BUTTON = 'inline-flex size-7 items-center justify-center rounded-md text-xs disabled:opacity-40';

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
  itemLabel = 'registros',
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  itemLabel?: string;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
      <span>
        Mostrando {first} a {last} de {total} {itemLabel}
      </span>
      <nav className="flex items-center gap-1" aria-label="Paginação">
        <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} className={cn(PAGE_BUTTON, 'hover:bg-neutral-100')} aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </button>
        {pageNumbers(page, totalPages).map((entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} className="px-1">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={cn(PAGE_BUTTON, entry === page ? 'bg-neutral-900 font-medium text-white' : 'text-neutral-700 hover:bg-neutral-100')}
            >
              {entry}
            </button>
          ),
        )}
        <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} className={cn(PAGE_BUTTON, 'hover:bg-neutral-100')} aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </button>
      </nav>
    </div>
  );
}
