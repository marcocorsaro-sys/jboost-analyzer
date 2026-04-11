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

const DRIVER_COLORS: Record<string, string> = {
  compliance: '#8b5cf6',
  experience: '#06b6d4',
  discoverability: '#f59e0b',
  content: '#ec4899',
  accessibility: '#10b981',
  authority: '#ef4444',
  aso_visibility: '#6366f1',
  ai_relevance: '#14b8a6',
  awareness: '#f97316',
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
        color: '#6b7280',
        fontSize: '13px',
        background: '#111318',
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
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" />
        <XAxis
          dataKey="dateLabel"
          stroke="#6b7280"
          fontSize={11}
          fontFamily="'JetBrains Mono', monospace"
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          stroke="#6b7280"
          fontSize={11}
          fontFamily="'JetBrains Mono', monospace"
          tickLine={false}
          width={35}
        />
        <Tooltip
          contentStyle={{
            background: '#1a1c24',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
          labelStyle={{ color: '#c8e64a', fontWeight: 600 }}
          itemStyle={{ padding: '2px 0' }}
        />
        {(showOverall || drivers.length === 0) && (
          <Legend
            wrapperStyle={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}
          />
        )}

        {/* Overall score line */}
        {showOverall && (
          <Line
            type="monotone"
            dataKey="overall_score"
            stroke="#c8e64a"
            strokeWidth={2.5}
            dot={{ fill: '#c8e64a', strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: '#c8e64a' }}
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
            stroke={DRIVER_COLORS[driverKey] || '#6b7280'}
            strokeWidth={1.5}
            dot={{ fill: DRIVER_COLORS[driverKey] || '#6b7280', strokeWidth: 0, r: 3 }}
            name={DRIVER_LABELS[driverKey] || driverKey}
            connectNulls
            strokeDasharray={showOverall ? '4 2' : undefined}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
