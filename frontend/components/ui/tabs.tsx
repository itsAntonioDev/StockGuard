'use client';

import { cn } from '@/lib/cn';

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={cn(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            tab.value === value ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
