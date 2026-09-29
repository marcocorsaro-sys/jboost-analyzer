'use client'

/**
 * V4 — visits-per-month trend, brand vs competitor (Sprint 2 item 17).
 *
 * One line per site over the months ACTUALLY PRESENT in the payload
 * (months_series when the run saved the full window, months_used otherwise).
 * Same loading pattern as V4Histogram: next/dynamic ssr:false keeps recharts
 * out of the initial JS; palette from lib/brand (client navy, competitors in
 * the navy declinations); axes at 13-14px.
 *
 * Null discipline: a site with no monthly series is not drawn as a flat 0 —
 * it is left out and listed in the footnote.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import { B } from '@/lib/brand'

export interface TrendSeries {
  name: string
  isClient: boolean
  /** month = "YYYY-MM" (or the payload's own date string), sorted ascending. */
  points: Array<{ month: string; value: number }>
}

interface V4TrendChartProps {
  title: string
  series: TrendSeries[]
  /** Formatter for the Y axis / tooltip values (thousands separators). */
  formatValue: (value: number) => string
  /** Formatter for the month labels ("2026-03" -> "mar 2026"). */
  formatMonthLabel: (month: string) => string
  notMeasuredLabel: string
}

export default function V4TrendChart({
  title,
  series,
  formatValue,
  formatMonthLabel,
  notMeasuredLabel,
}: V4TrendChartProps) {
  const withData = series.filter((s) => s.points.length > 0)
  const without = series.filter((s) => s.points.length === 0)

  // Union of the months present, ascending: each row = one month, one column
  // per site. A site missing that month simply has no dot (connectNulls off).
  const months = [...new Set(withData.flatMap((s) => s.points.map((p) => p.month)))].sort()
  const data = months.map((month) => {
    const row: Record<string, unknown> = { month }
    for (const s of withData) {
      const point = s.points.find((p) => p.month === month)
      if (point) row[s.name] = point.value
    }
    return row
  })

  const colorOf = (s: TrendSeries, i: number): string =>
    s.isClient ? B.chartClient : B.chartCompetitors[i % B.chartCompetitors.length]

  // Stable competitor color index (client excluded from the rotation).
  let compIndex = -1

  return (
    <div
      style={{
        background: B.bg,
        borderRadius: B.radius.card,
        border: `1px solid ${B.border}`,
        padding: '28px 32px',
        boxShadow: B.shadow.card,
      }}
    >
      <h4 style={{ ...B.type.h3, color: B.ink, margin: '0 0 20px 0' }}>{title}</h4>
      {withData.length === 0 || months.length === 0 ? (
        <div style={{ color: B.muted, fontSize: '15px' }}>—</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={B.chartGrid} vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: B.muted, fontSize: 13, fontWeight: 600 }}
              tickFormatter={formatMonthLabel}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: B.border }}
            />
            <YAxis
              tick={{ fill: B.muted, fontSize: 13 }}
              tickFormatter={(v: number) => formatValue(v)}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              cursor={{ stroke: B.border }}
              contentStyle={{
                background: B.bg,
                border: `1px solid ${B.border}`,
                borderRadius: '12px',
                boxShadow: B.shadow.cardHover,
                color: B.ink,
                fontSize: '14px',
              }}
              labelFormatter={(label) => formatMonthLabel(String(label))}
              formatter={(value: number) => [formatValue(value), '']}
            />
            <Legend wrapperStyle={{ fontSize: '13px' }} />
            {withData.map((s) => {
              if (!s.isClient) compIndex += 1
              const color = colorOf(s, s.isClient ? 0 : compIndex)
              return (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={color}
                  strokeWidth={s.isClient ? 3 : 2}
                  dot={{ r: s.isClient ? 4 : 3, fill: color, strokeWidth: 0 }}
                  connectNulls={false}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
      {without.length > 0 && (
        <div style={{ marginTop: '12px', fontSize: '14px', color: B.muted }}>
          {notMeasuredLabel}: {without.map((s) => s.name).join(', ')}
        </div>
      )}
    </div>
  )
}
