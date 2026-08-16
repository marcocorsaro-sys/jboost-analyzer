'use client'

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

interface SpiderChartProps {
  driverScores: Record<string, number | null>
  competitorScores?: Array<{ domain: string; scores: Record<string, number | null> }>
  /**
   * Axis set + labels. Defaults to the V1 driver catalog (below) so every
   * existing V1 caller is untouched; the V4 Overview passes the registry
   * labels of the active drivers in Business-first order.
   */
  labels?: Record<string, string>
  title?: string
  /**
   * V4 convention: null = "not measured" and must never render as 0.
   * When true, a missing score becomes a gap in the radar instead of a
   * zero-spike. Default false to preserve the V1 behaviour byte for byte.
   */
  strictNulls?: boolean
  /** Series name for the main radar (default "Your Score"). */
  primaryName?: string
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

const COMPETITOR_COLORS = ['#6366f1', '#f59e0b', '#ec4899', '#06b6d4']

export default function SpiderChart({
  driverScores,
  competitorScores = [],
  labels,
  title,
  strictNulls = false,
  primaryName,
}: SpiderChartProps) {
  const labelMap = labels ?? DRIVER_LABELS
  const driverKeys = Object.keys(labelMap)

  const data = driverKeys.map(key => {
    const point: Record<string, unknown> = {
      driver: labelMap[key] || key,
      score: driverScores[key] ?? (strictNulls ? null : 0),
    }
    competitorScores.forEach((comp, i) => {
      point[`comp_${i}`] = comp.scores[key] ?? (strictNulls ? null : 0)
    })
    return point
  })

  return (
    <div style={{
      background: '#1a1d24',
      borderRadius: '12px',
      border: '1px solid #2a2d35',
      padding: '24px',
    }}>
      <h3 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '14px',
        fontWeight: 600,
        color: '#ffffff',
        marginBottom: '16px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {title ?? 'Driver Radar'}
      </h3>
      <ResponsiveContainer width="100%" height={380}>
        <RadarChart data={data}>
          <PolarGrid stroke="#2a2d35" />
          <PolarAngleAxis
            dataKey="driver"
            tick={{ fill: '#a0a0a0', fontSize: 11 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: '#6b7280', fontSize: 10 }}
          />
          <Radar
            name={primaryName ?? 'Your Score'}
            dataKey="score"
            stroke="#c8e64a"
            fill="#c8e64a"
            fillOpacity={0.2}
            strokeWidth={2}
          />
          {competitorScores.map((comp, i) => (
            <Radar
              key={comp.domain}
              name={comp.domain}
              dataKey={`comp_${i}`}
              stroke={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]}
              fill={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]}
              fillOpacity={0.05}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          ))}
          <Tooltip
            contentStyle={{
              background: '#1e2028',
              border: '1px solid #2a2d35',
              borderRadius: '8px',
              color: '#ffffff',
              fontSize: '12px',
            }}
          />
          {competitorScores.length > 0 && (
            <Legend
              wrapperStyle={{ fontSize: '12px', color: '#a0a0a0' }}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
