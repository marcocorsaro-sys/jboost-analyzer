'use client'

import { getScoreBand } from '@/lib/constants'

interface ScoreDisplayProps {
  score: number | null
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

export default function ScoreDisplay({ score, size = 'md', showLabel = true }: ScoreDisplayProps) {
  const band = score !== null ? getScoreBand(score) : null
  const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  const sizes = {
    sm: { box: 40, font: 14, labelFont: 10 },
    md: { box: 64, font: 22, labelFont: 11 },
    lg: { box: 100, font: 36, labelFont: 13 },
  }

  const s = sizes[size]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <div
        style={{
          width: s.box,
          height: s.box,
          borderRadius: size === 'lg' ? '16px' : '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: s.font,
          fontWeight: 700,
          background: `${color}15`,
          color,
          border: `2px solid ${color}30`,
        }}
      >
        {score ?? '—'}
      </div>
      {showLabel && band && (
        <span style={{ fontSize: s.labelFont, color, fontWeight: 500 }}>
          {band.label}
        </span>
      )}
    </div>
  )
}
