'use client'

/**
 * V4 — per-driver competitor histogram (Bibbia sheet 6 v5: "Each driver
 * detail renders a competitor HISTOGRAM; the Overview renders the RADAR").
 *
 * One bar per site, client highlighted. Loaded ONLY via next/dynamic
 * ssr:false (same pattern as the V1 SpiderChart) so recharts stays out of
 * the page's initial JS.
 *
 * Null discipline: a site whose value is null is NOT drawn as a zero bar —
 * it is excluded from the chart and listed in the footnote. 0 is a
 * measurement; null is the absence of one.
 */

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { B } from '@/lib/brand'

export interface HistogramSite {
  name: string
  value: number | null
  /** Secondary number shown in the tooltip (the raw before normalization). */
  raw?: number | null
  isClient: boolean
}

interface V4HistogramProps {
  title: string
  sites: HistogramSite[]
  /** Y axis upper bound; scores are 0-100. */
  maxValue?: number
  notMeasuredLabel: string
  rawLabel: string
}

const CLIENT_COLOR = B.chartClient
const COMPETITOR_COLOR = B.chartCompetitors[0]

export default function V4Histogram({
  title,
  sites,
  maxValue = 100,
  notMeasuredLabel,
  rawLabel,
}: V4HistogramProps) {
  const measured = sites.filter((s) => s.value !== null && s.value !== undefined)
  const unmeasured = sites.filter((s) => s.value === null || s.value === undefined)

  return (
    <div
      style={{
        background: B.surface,
        borderRadius: '12px',
        border: `1px solid ${B.border}`,
        padding: '20px',
      }}
    >
      <h4
        style={{
          fontFamily: B.fontMono,
          fontSize: '12px',
          fontWeight: 600,
          color: B.ink,
          margin: '0 0 14px 0',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {title}
      </h4>
      {measured.length === 0 ? (
        <div style={{ color: B.muted, fontSize: '13px' }}>—</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={measured} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid stroke={B.border} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: B.muted, fontSize: 11 }}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: B.border }}
            />
            <YAxis
              domain={[0, maxValue]}
              tick={{ fill: B.muted, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: `${B.border}40` }}
              contentStyle={{
                background: B.surface2,
                border: `1px solid ${B.border}`,
                borderRadius: '8px',
                color: B.ink,
                fontSize: '12px',
              }}
              formatter={(value: number, _name, entry) => {
                const raw = (entry?.payload as HistogramSite | undefined)?.raw
                return raw !== null && raw !== undefined
                  ? [`${value} (${rawLabel} ${raw})`, '']
                  : [String(value), '']
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64}>
              {measured.map((s) => (
                <Cell key={s.name} fill={s.isClient ? CLIENT_COLOR : COMPETITOR_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {unmeasured.length > 0 && (
        <div style={{ marginTop: '10px', fontSize: '11px', color: B.muted }}>
          {notMeasuredLabel}: {unmeasured.map((s) => s.name).join(', ')}
        </div>
      )}
    </div>
  )
}
