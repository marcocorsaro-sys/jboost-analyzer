'use client'

import { getTrendArrow, getTrendColor, type TrendDelta } from '@/lib/trends/calculate'

interface TrendArrowProps {
  delta: TrendDelta
  showValue?: boolean
  size?: 'sm' | 'md'
}

export default function TrendArrow({ delta, showValue = true, size = 'sm' }: TrendArrowProps) {
  if (delta.direction === 'unknown') return null

  const color = getTrendColor(delta.direction)
  const arrow = getTrendArrow(delta.direction)
  const fontSize = size === 'sm' ? '11px' : '13px'

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      fontSize,
      fontWeight: 600,
      fontFamily: "'JetBrains Mono', monospace",
      color,
    }}>
      <span>{arrow}</span>
      {showValue && delta.delta !== null && (
        <span>{delta.delta > 0 ? '+' : ''}{Math.round(delta.delta)}</span>
      )}
    </span>
  )
}
