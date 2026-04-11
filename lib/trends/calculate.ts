export interface TrendPoint {
  date: string          // ISO date
  overall_score: number | null
  drivers: Record<string, number | null>
}

export interface TrendDelta {
  current: number | null
  previous: number | null
  delta: number | null       // current - previous
  deltaPercent: number | null // ((current - previous) / previous) * 100
  direction: 'up' | 'down' | 'stable' | 'unknown'
}

/**
 * Calculate delta between two score values.
 */
export function calcDelta(current: number | null, previous: number | null): TrendDelta {
  if (current === null || previous === null) {
    return { current, previous, delta: null, deltaPercent: null, direction: 'unknown' }
  }

  const delta = current - previous
  const deltaPercent = previous !== 0 ? (delta / previous) * 100 : null

  let direction: TrendDelta['direction'] = 'stable'
  if (delta > 1) direction = 'up'
  else if (delta < -1) direction = 'down'

  return { current, previous, delta, deltaPercent, direction }
}

/**
 * Get trend arrow character based on direction.
 */
export function getTrendArrow(direction: TrendDelta['direction']): string {
  switch (direction) {
    case 'up': return '↑'
    case 'down': return '↓'
    case 'stable': return '→'
    default: return '—'
  }
}

/**
 * Get trend color based on direction (green=up, red=down, gray=stable/unknown).
 */
export function getTrendColor(direction: TrendDelta['direction']): string {
  switch (direction) {
    case 'up': return '#22c55e'
    case 'down': return '#ef4444'
    case 'stable': return '#6b7280'
    default: return '#6b7280'
  }
}
