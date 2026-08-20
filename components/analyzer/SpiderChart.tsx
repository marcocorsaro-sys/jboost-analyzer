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
import { B } from '@/lib/brand'

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
  /**
   * Optional brand overrides (backwards-compatible): stroke/fill of the
   * client radar and the competitor series palette. Default to the JAKALA
   * tokens in lib/brand.ts (navy client, navy-declination competitors).
   */
  primaryColor?: string
  competitorColors?: string[]
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

const COMPETITOR_COLORS = B.chartCompetitors

export default function SpiderChart({
  driverScores,
  competitorScores = [],
  labels,
  title,
  strictNulls = false,
  primaryName,
  primaryColor = B.chartClient,
  competitorColors = COMPETITOR_COLORS,
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
      background: B.surface,
      borderRadius: '12px',
      border: `1px solid ${B.border}`,
      padding: '24px',
    }}>
      <h3 style={{
        fontFamily: B.fontMono,
        fontSize: '14px',
        fontWeight: 600,
        color: B.ink,
        marginBottom: '16px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {title ?? 'Driver Radar'}
      </h3>
      <ResponsiveContainer width="100%" height={380}>
        <RadarChart data={data}>
          <PolarGrid stroke={B.border} />
          <PolarAngleAxis
            dataKey="driver"
            tick={{ fill: B.muted, fontSize: 11 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: B.muted, fontSize: 10 }}
          />
          <Radar
            name={primaryName ?? 'Your Score'}
            dataKey="score"
            stroke={primaryColor}
            fill={primaryColor}
            fillOpacity={0.2}
            strokeWidth={2}
          />
          {competitorScores.map((comp, i) => (
            <Radar
              key={comp.domain}
              name={comp.domain}
              dataKey={`comp_${i}`}
              stroke={competitorColors[i % competitorColors.length]}
              fill={competitorColors[i % competitorColors.length]}
              fillOpacity={0.05}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          ))}
          <Tooltip
            contentStyle={{
              background: B.surface2,
              border: `1px solid ${B.border}`,
              borderRadius: '8px',
              color: B.ink,
              fontSize: '12px',
            }}
          />
          {competitorScores.length > 0 && (
            <Legend
              wrapperStyle={{ fontSize: '12px', color: B.muted }}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
