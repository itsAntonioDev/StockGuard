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
  height = 240,
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
        <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={formatX} tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={{ stroke: '#e5e5e5' }} />
          <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip
            labelFormatter={(value) => (formatX ? formatX(String(value)) : String(value))}
            formatter={(value) => `${formatNumber(typeof value === 'number' ? value : Number(value), 2)}${valueSuffix}`}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend verticalAlign="top" align="right" height={28} iconSize={8} wrapperStyle={{ fontSize: 11, color: '#525252' }} />
          {series.map((line, index) => (
            <Line
              key={line.key}
              type="linear"
              dataKey={line.key}
              name={line.label}
              stroke={line.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={1.5}
              dot={{ r: 3, strokeWidth: 1.5, fill: '#fff' }}
              activeDot={{ r: 4 }}
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
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate text-neutral-700">{item.label}</span>
          <div className="h-2.5 rounded-sm bg-neutral-100">
            <div className="h-2.5 rounded-sm bg-neutral-700" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <span className="w-10 text-right font-medium text-neutral-900">
            {formatValue(item.value)}
            {item.hint && <span className="ml-1 font-normal text-neutral-500">{item.hint}</span>}
          </span>
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
