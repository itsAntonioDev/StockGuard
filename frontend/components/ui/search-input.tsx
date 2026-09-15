import { Search } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Input } from './form';

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Ícone decorativo à direita (ex.: leitor de código de barras). */
  trailing?: ReactNode;
}

/** Campo de busca com lupa, sem rótulo visível (use aria-label). */
export function SearchInput({ className, trailing, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
      <Input type="search" className={cn('pl-9', trailing ? 'pr-9' : undefined)} {...props} />
      {trailing && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400">{trailing}</span>}
    </div>
  );
}
