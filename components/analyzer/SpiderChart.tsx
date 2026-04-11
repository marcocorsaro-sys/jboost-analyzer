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

export default function SpiderChart({ driverScores, competitorScores = [] }: SpiderChartProps) {
  const driverKeys = Object.keys(DRIVER_LABELS)

  const data = driverKeys.map(key => {
    const point: Record<string, unknown> = {
      driver: DRIVER_LABELS[key] || key,
      score: driverScores[key] ?? 0,
    }
    competitorScores.forEach((comp, i) => {
      point[`comp_${i}`] = comp.scores[key] ?? 0
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
        Driver Radar
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
            name="Your Score"
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
