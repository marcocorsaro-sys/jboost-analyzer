'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { B } from '@/lib/brand'

interface TrendDataPoint {
  date: string
  overall_score: number | null
  [driverName: string]: string | number | null
}

interface TrendChartProps {
  data: TrendDataPoint[]
  drivers?: string[]
  height?: number
  showOverall?: boolean
}

// Categorical series palette (legacy V1 trend): brand tokens where a
// semantic exists, AA-darkened distinct hues (readable on white) elsewhere.
const DRIVER_COLORS: Record<string, string> = {
  compliance: '#7c3aed',
  experience: '#0e7490',
  discoverability: B.warning,
  content: '#db2777',
  accessibility: B.success,
  authority: B.error,
  aso_visibility: B.chartCompetitors[0],
  ai_relevance: B.teal,
  awareness: '#c2410c',
}

const DRIVER_LABELS: Record<string, string> = {
  compliance: 'Compliance',
  experience: 'Experience',
  discoverability: 'Discoverability',
  content: 'Content',
  accessibility: 'Accessibility',
  authority: 'Authority',
  aso_visibility: 'ASO Visibility',
  ai_relevance: 'AI Relevance',
  awareness: 'Awareness',
}

export default function TrendChart({
  data,
  drivers = [],
  height = 300,
  showOverall = true,
}: TrendChartProps) {
  if (data.length < 2) {
    return (
      <div style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: B.muted,
        fontSize: '13px',
        background: B.bg,
        borderRadius: '8px',
      }}>
        Servono almeno 2 analisi per visualizzare il trend
      </div>
    )
  }

  // Format date for XAxis
  const formattedData = data.map(d => ({
    ...d,
    dateLabel: new Date(d.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formattedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={B.border} />
        <XAxis
          dataKey="dateLabel"
          stroke={B.muted}
          fontSize={11}
          fontFamily={B.fontMono}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          stroke={B.muted}
          fontSize={11}
          fontFamily={B.fontMono}
          tickLine={false}
          width={35}
        />
        <Tooltip
          contentStyle={{
            background: B.surface,
            border: `1px solid ${B.border}`,
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: B.fontMono,
          }}
          labelStyle={{ color: B.primary, fontWeight: 600 }}
          itemStyle={{ padding: '2px 0' }}
        />
        {(showOverall || drivers.length === 0) && (
          <Legend
            wrapperStyle={{ fontSize: '11px', fontFamily: B.fontMono }}
          />
        )}

        {/* Overall score line */}
        {showOverall && (
          <Line
            type="monotone"
            dataKey="overall_score"
            stroke={B.primary}
            strokeWidth={2.5}
            dot={{ fill: B.primary, strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: B.primary }}
            name="Score Totale"
            connectNulls
          />
        )}

        {/* Driver lines */}
        {drivers.map(driverKey => (
          <Line
            key={driverKey}
            type="monotone"
            dataKey={driverKey}
            stroke={DRIVER_COLORS[driverKey] || B.muted}
            strokeWidth={1.5}
            dot={{ fill: DRIVER_COLORS[driverKey] || B.muted, strokeWidth: 0, r: 3 }}
            name={DRIVER_LABELS[driverKey] || driverKey}
            connectNulls
            strokeDasharray={showOverall ? '4 2' : undefined}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
