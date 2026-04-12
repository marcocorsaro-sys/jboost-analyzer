'use client'

import { useState, useMemo } from 'react'

interface Solution {
  title: string
  description: string
  impact: string
  effort_level: string
  estimated_improvement: number
  timeframe: string
  driver?: string
}

interface RoadmapGanttProps {
  solutions: Solution[]
}

const TIMEFRAME_ORDER = ['quick_win', 'short_term', 'medium_term', 'long_term'] as const
const TIMEFRAME_LABELS: Record<string, string> = {
  quick_win: '1-2 Weeks',
  short_term: '1-2 Months',
  medium_term: '3-6 Months',
  long_term: '6+ Months',
}

const IMPACT_COLORS: Record<string, string> = {
  high: '#22c55e',
  medium: '#f59e0b',
  low: '#6b7280',
}

type TimeFilter = 'all' | 'quick_win' | 'short_term' | 'medium_term' | 'long_term'

export default function RoadmapGantt({ solutions }: RoadmapGanttProps) {
  const [filter, setFilter] = useState<TimeFilter>('all')

  // Filter and group solutions by timeframe (Bug #5: reactive filtering)
  const grouped = useMemo(() => {
    const filtered = filter === 'all'
      ? solutions
      : solutions.filter((s) => s.timeframe === filter)

    const groups: Record<string, Solution[]> = {}
    for (const tf of TIMEFRAME_ORDER) {
      const items = filtered.filter((s) => s.timeframe === tf)
      if (items.length > 0) {
        groups[tf] = items
      }
    }
    return groups
  }, [solutions, filter])

  const totalItems = Object.values(grouped).flat().length

  if (solutions.length === 0) {
    return (
      <div
        className="p-6 rounded-xl text-center"
        style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
      >
        <p className="text-sm" style={{ color: 'var(--gray)' }}>
          No solutions available yet. Generate solutions for drivers first.
        </p>
      </div>
    )
  }

  return (
    <div
      className="p-6 rounded-xl space-y-5"
      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
    >
      {/* Header with filter */}
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: 'var(--lime)' }}
        >
          Implementation Roadmap
        </h3>
        <div className="flex gap-1.5">
          {(['all', ...TIMEFRAME_ORDER] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setFilter(tf as TimeFilter)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={{
                background: filter === tf ? 'var(--lime)' : 'var(--card2)',
                color: filter === tf ? 'var(--bg)' : 'var(--gray)',
              }}
            >
              {tf === 'all' ? 'All' : TIMEFRAME_LABELS[tf]}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <p className="text-xs" style={{ color: 'var(--gray)' }}>
        Showing {totalItems} action{totalItems !== 1 ? 's' : ''}
        {filter !== 'all' ? ` in ${TIMEFRAME_LABELS[filter]}` : ''}
      </p>

      {/* Timeline */}
      {totalItems === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--gray)' }}>
          No actions match this time filter.
        </p>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([timeframe, items]) => (
            <div key={timeframe}>
              {/* Timeframe header */}
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="h-px flex-1"
                  style={{ background: 'hsl(var(--border))' }}
                />
                <span
                  className="text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full"
                  style={{ background: 'var(--card2)', color: 'var(--lime-dim)' }}
                >
                  {TIMEFRAME_LABELS[timeframe]}
                </span>
                <div
                  className="h-px flex-1"
                  style={{ background: 'hsl(var(--border))' }}
                />
              </div>

              {/* Items */}
              <div className="space-y-2 pl-4">
                {items.map((sol, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg"
                    style={{ background: 'var(--card2)' }}
                  >
                    {/* Impact dot */}
                    <div
                      className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                      style={{ background: IMPACT_COLORS[sol.impact] || IMPACT_COLORS.medium }}
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium" style={{ color: 'var(--white)' }}>
                          {sol.title}
                        </span>
                        {sol.driver && (
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(200, 230, 74, 0.08)', color: 'var(--lime-dim)' }}
                          >
                            {sol.driver}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs" style={{ color: 'var(--gray)' }}>
                        <span>Impact: <span style={{ color: IMPACT_COLORS[sol.impact] }}>{sol.impact}</span></span>
                        <span>Effort: {sol.effort_level}</span>
                        <span>+{sol.estimated_improvement} pts</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
