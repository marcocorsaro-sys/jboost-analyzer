'use client'

import { useState } from 'react'
import { getScoreBand } from '@/lib/constants'

interface Solution {
  title: string
  description: string
  impact: string
  effort: string
  estimated_improvement: number
  timeframe: string
  category: string
}

interface DriverDetailProps {
  driverName: string
  driverLabel: string
  score: number | null
  status: string
  issues: (string | Record<string, unknown>)[]
  solutions: Solution[]
  rawData: Record<string, unknown>
  onGenerateSolutions?: () => void
  isGenerating?: boolean
}

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

export default function DriverDetail({
  driverName,
  driverLabel,
  score,
  status,
  issues = [],
  solutions = [],
  rawData,
  onGenerateSolutions,
  isGenerating = false,
}: DriverDetailProps) {
  const [expanded, setExpanded] = useState(false)
  const band = score !== null ? getScoreBand(score) : null
  const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  return (
    <div
      style={{
        background: '#1a1d24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        overflow: 'hidden',
      }}
    >
      {/* Header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#1e2028')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Score */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            background: `${color}15`,
            color,
            flexShrink: 0,
          }}
        >
          {score ?? '—'}
        </div>

        {/* Name + status */}
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '14px',
            fontWeight: 600,
            color: '#ffffff',
          }}>
            {driverLabel}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {band?.label ?? status}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: '120px', flexShrink: 0 }}>
          <div style={{
            height: '6px',
            borderRadius: '3px',
            background: '#2a2d35',
            overflow: 'hidden',
          }}>
            <div
              style={{
                height: '100%',
                width: `${score ?? 0}%`,
                background: color,
                borderRadius: '3px',
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>

        {/* Expand icon */}
        <span style={{
          color: '#6b7280',
          fontSize: '16px',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
        }}>
          ▶
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid #2a2d35' }}>
          {/* Issues */}
          {issues.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                fontWeight: 600,
                color: '#ef4444',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
              }}>
                Issues Found
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {issues.map((issue, i) => {
                  const issueObj = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : null
                  const title = issueObj ? String(issueObj.title || '') : String(issue)
                  const description = issueObj ? String(issueObj.description || '') : ''
                  const severity = issueObj ? String(issueObj.severity || 'medium') : 'medium'
                  const sevColor = severity === 'high' ? '#ef4444' : severity === 'medium' ? '#f59e0b' : '#6b7280'

                  return (
                    <div key={i} style={{
                      fontSize: '13px',
                      color: '#a0a0a0',
                      padding: '8px 12px',
                      background: `${sevColor}10`,
                      borderRadius: '6px',
                      borderLeft: `3px solid ${sevColor}`,
                    }}>
                      <div style={{ fontWeight: 600, color: '#ffffff', marginBottom: description ? '4px' : 0 }}>
                        {title}
                      </div>
                      {description && <div style={{ fontSize: '12px' }}>{description}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Solutions */}
          {solutions.length > 0 ? (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                fontWeight: 600,
                color: '#c8e64a',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
              }}>
                Recommended Solutions
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {solutions.map((sol, i) => (
                  <div key={i} style={{
                    padding: '12px 16px',
                    background: '#1e2028',
                    borderRadius: '8px',
                    border: '1px solid #2a2d35',
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '6px',
                    }}>
                      <span style={{
                        fontWeight: 600,
                        fontSize: '13px',
                        color: '#ffffff',
                      }}>
                        {sol.title}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: sol.impact === 'high' ? '#22c55e15' : sol.impact === 'medium' ? '#f59e0b15' : '#6b728015',
                        color: sol.impact === 'high' ? '#22c55e' : sol.impact === 'medium' ? '#f59e0b' : '#6b7280',
                        fontWeight: 600,
                      }}>
                        {sol.impact} impact
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#a0a0a0', lineHeight: '1.5', margin: '0 0 8px' }}>
                      {sol.description}
                    </p>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#6b7280' }}>
                      <span>+{sol.estimated_improvement} pts</span>
                      <span>{sol.timeframe}</span>
                      <span>Effort: {sol.effort || (sol as unknown as Record<string, string>).effort_level || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : onGenerateSolutions ? (
            <div style={{ marginTop: '16px' }}>
              <button
                onClick={(e) => { e.stopPropagation(); onGenerateSolutions(); }}
                disabled={isGenerating}
                style={{
                  padding: '8px 16px',
                  background: isGenerating ? '#2a2d35' : '#c8e64a',
                  color: isGenerating ? '#6b7280' : '#111318',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isGenerating ? 'default' : 'pointer',
                }}
              >
                {isGenerating ? 'Generating Solutions...' : 'Generate AI Solutions'}
              </button>
            </div>
          ) : null}

          {/* Raw data */}
          {rawData && Object.keys(rawData).length > 0 && (
            <details style={{ marginTop: '16px' }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: '11px',
                color: '#6b7280',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                Raw Data
              </summary>
              <pre style={{
                marginTop: '8px',
                padding: '12px',
                background: '#111318',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#a0a0a0',
                overflow: 'auto',
                maxHeight: '200px',
              }}>
                {JSON.stringify(rawData, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
