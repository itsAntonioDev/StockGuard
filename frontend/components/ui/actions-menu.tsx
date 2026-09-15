'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface ActionItem {
  label: string;
  href?: string;
  onClick?: () => void;
  tone?: 'danger';
  hidden?: boolean;
}

/** Menu "⋯" da coluna Ações. Fecha com clique fora ou Esc. */
export function ActionsMenu({ items, label = 'Ações' }: { items: ActionItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const visible = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (visible.length === 0) return null;

  const itemClass = (item: ActionItem) =>
    cn('block w-full px-3 py-2 text-left text-[13px] hover:bg-neutral-50', item.tone === 'danger' ? 'text-red-700' : 'text-neutral-800');

  return (
    <div ref={container} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {visible.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} role="menuitem" className={itemClass(item)} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={itemClass(item)}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
