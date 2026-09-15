'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber } from '@/lib/format';

export const CHART_COLORS = ['#171717', '#a3a3a3', '#0284c7', '#dc2626', '#16a34a', '#d97706'];

interface LineSeries {
  key: string;
  label: string;
  color?: string;
}

export function TrendChart({
  data,
  xKey,
  series,
  height = 260,
  formatX,
  valueSuffix = '',
}: {
  data: object[];
  xKey: string;
  series: LineSeries[];
  height?: number;
  formatX?: (value: string) => string;
  valueSuffix?: string;
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e5e5e5" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={formatX} tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={{ stroke: '#e5e5e5' }} />
          <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <Tooltip
            labelFormatter={(value) => (formatX ? formatX(String(value)) : String(value))}
            formatter={(value) => `${formatNumber(typeof value === 'number' ? value : Number(value), 2)}${valueSuffix}`}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((line, index) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarList({ items, formatValue = (value) => formatNumber(value) }: { items: Array<{ key: string; label: string; value: number; hint?: string }>; formatValue?: (value: number) => string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-neutral-800">{item.label}</span>
            <span className="shrink-0 font-medium text-neutral-900">
              {formatValue(item.value)}
              {item.hint && <span className="ml-1 text-xs font-normal text-neutral-500">{item.hint}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-neutral-800" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${value} de ${total}`}>
      <div className="h-2 w-24 rounded-full bg-neutral-100">
        <div className="h-2 rounded-full bg-neutral-800" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-neutral-500">
        {value}/{total}
      </span>
    </div>
  );
}
