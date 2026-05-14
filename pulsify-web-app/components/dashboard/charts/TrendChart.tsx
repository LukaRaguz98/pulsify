'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { ComponentProps } from 'react'

export type ChartSeries = {
  key: string
  name: string
  color: string
}

export type ChartKind = 'bar' | 'line'

type Props = {
  data: Record<string, unknown>[]
  series: ChartSeries[]
  xKey: string
  kind?: ChartKind
  height?: number
  xTickFormatter?: (value: string) => string
  yTickFormatter?: (value: number) => string
  tooltipValueFormatter?: (value: number, name: string) => string
  stacked?: boolean
  showLegend?: boolean
}

const axisTick = { fontSize: 11, fill: 'var(--text-3)' }

export function TrendChart({
  data,
  series,
  xKey,
  kind = 'line',
  height = 240,
  xTickFormatter,
  yTickFormatter,
  tooltipValueFormatter,
  stacked = false,
  showLegend = false,
}: Props) {
  // Show ~8 evenly spaced x-axis labels. A fixed interval keeps the spacing
  // uniform — recharts' default width-based thinning drops labels unevenly.
  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1)

  const tooltipProps: ComponentProps<typeof Tooltip> = {
    contentStyle: {
      background: 'var(--panel-2)',
      border: '1px solid var(--line-strong)',
      borderRadius: 10,
      fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    },
    labelStyle: { color: 'var(--text-2)', marginBottom: 4 },
    itemStyle: { padding: '1px 0' },
    formatter: tooltipValueFormatter
      ? (value, name) => [tooltipValueFormatter(Number(value), String(name)), name]
      : undefined,
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === 'bar' ? (
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={axisTick}
            tickFormatter={xTickFormatter}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={axisTick}
            tickFormatter={yTickFormatter}
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
          />
          <Tooltip {...tooltipProps} cursor={{ fill: 'var(--p-soft)' }} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.color}
              radius={[4, 4, 0, 0]}
              stackId={stacked ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      ) : (
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={axisTick}
            tickFormatter={xTickFormatter}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={axisTick}
            tickFormatter={yTickFormatter}
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
          />
          <Tooltip {...tooltipProps} cursor={{ stroke: 'var(--line-strong)' }} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}
