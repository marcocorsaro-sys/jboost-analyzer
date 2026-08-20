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
  LabelList,
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
        background: B.bg,
        borderRadius: B.radius.card,
        border: `1px solid ${B.border}`,
        padding: '28px 32px',
        boxShadow: B.shadow.card,
      }}
    >
      <h4
        style={{
          ...B.type.h3,
          color: B.ink,
          margin: '0 0 20px 0',
        }}
      >
        {title}
      </h4>
      {measured.length === 0 ? (
        <div style={{ color: B.muted, fontSize: '15px' }}>—</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={measured} margin={{ top: 28, right: 8, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={B.chartGrid} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: B.muted, fontSize: 14, fontWeight: 600 }}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: B.border }}
            />
            <YAxis
              domain={[0, maxValue]}
              tick={{ fill: B.muted, fontSize: 13 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: `${B.border}40` }}
              contentStyle={{
                background: B.bg,
                border: `1px solid ${B.border}`,
                borderRadius: '12px',
                boxShadow: B.shadow.cardHover,
                color: B.ink,
                fontSize: '14px',
              }}
              formatter={(value: number, _name, entry) => {
                const raw = (entry?.payload as HistogramSite | undefined)?.raw
                return raw !== null && raw !== undefined
                  ? [`${value} (${rawLabel} ${raw})`, '']
                  : [String(value), '']
              }}
            />
            <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={72}>
              {/* Value above every bar — the number must be readable at a glance. */}
              <LabelList
                dataKey="value"
                position="top"
                style={{ fill: B.ink, fontSize: '16px', fontWeight: 700 }}
              />
              {measured.map((s) => (
                <Cell key={s.name} fill={s.isClient ? CLIENT_COLOR : COMPETITOR_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {unmeasured.length > 0 && (
        <div style={{ marginTop: '12px', fontSize: '14px', color: B.muted }}>
          {notMeasuredLabel}: {unmeasured.map((s) => s.name).join(', ')}
        </div>
      )}
    </div>
  )
}
