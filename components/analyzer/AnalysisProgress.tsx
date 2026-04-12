'use client'

import { useEffect, useState } from 'react'

const PHASES = [
  { key: 'initializing', label: 'Initializing', icon: '⚙️' },
  { key: 'fetching_apis', label: 'Fetching API Data', icon: '📡' },
  { key: 'calculating_scores', label: 'Calculating Scores', icon: '📊' },
  { key: 'generating_issues', label: 'Identifying Issues', icon: '🔍' },
  { key: 'generating_solutions', label: 'Generating Solutions', icon: '💡' },
  { key: 'analyzing_competitors', label: 'Analyzing Competitors', icon: '🏆' },
  { key: 'generating_matrix', label: 'Building Priority Matrix', icon: '🎯' },
  { key: 'finalizing', label: 'Finalizing', icon: '✅' },
  { key: 'completed', label: 'Completed', icon: '🎉' },
]

interface AnalysisProgressProps {
  currentPhase: string | null
  phaseDetail: string | null
  status: string | null
  startedAt: string | null
}

export default function AnalysisProgress({
  currentPhase,
  phaseDetail,
  status,
  startedAt,
}: AnalysisProgressProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt || status === 'completed' || status === 'failed') return
    const start = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startedAt, status])

  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase)
  const progress = currentIndex >= 0 ? Math.round(((currentIndex + 1) / PHASES.length) * 100) : 0

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  if (status === 'failed') {
    return (
      <div
        className="p-6 rounded-xl"
        style={{
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xl">❌</span>
          <span className="font-semibold" style={{ color: 'var(--red)' }}>
            Analysis Failed
          </span>
        </div>
        {phaseDetail && (
          <p className="text-sm" style={{ color: 'var(--gray)' }}>
            {phaseDetail}
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="p-6 rounded-xl space-y-5"
      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>
            Analysis in Progress
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--gray)' }}>
            {phaseDetail || 'Processing...'}
          </p>
        </div>
        <div
          className="text-xs font-mono px-3 py-1 rounded-full"
          style={{ background: 'var(--card2)', color: 'var(--lime)' }}
        >
          {formatTime(elapsed)}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--card2)' }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${progress}%`, background: 'var(--lime)' }}
        />
      </div>

      {/* Phase steps */}
      <div className="space-y-1">
        {PHASES.map((phase, i) => {
          const isActive = phase.key === currentPhase
          const isComplete = currentIndex > i
          const isPending = currentIndex < i

          return (
            <div
              key={phase.key}
              className="flex items-center gap-3 py-1.5 px-3 rounded-lg text-xs transition-all"
              style={{
                background: isActive ? 'rgba(200, 230, 74, 0.06)' : 'transparent',
                opacity: isPending ? 0.35 : 1,
              }}
            >
              <span className="w-5 text-center">
                {isComplete ? (
                  <span style={{ color: 'var(--green)' }}>✓</span>
                ) : isActive ? (
                  <span className="inline-block animate-pulse">{phase.icon}</span>
                ) : (
                  <span style={{ color: 'var(--gray)' }}>○</span>
                )}
              </span>
              <span
                className="font-medium"
                style={{
                  color: isActive
                    ? 'var(--lime)'
                    : isComplete
                      ? 'var(--green)'
                      : 'var(--gray)',
                }}
              >
                {phase.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
