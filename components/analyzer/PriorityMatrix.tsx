'use client'

import { useState } from 'react'
import { useLocale } from '@/lib/i18n/context'
import { B } from '@/lib/brand'

interface MatrixItem {
  title: string
  driver: string
  description: string
  impact_score: number
  effort_score: number
}

interface PriorityMatrixProps {
  opportunities: MatrixItem[]
  issues: MatrixItem[]
  improvements: MatrixItem[]
  suggestions: MatrixItem[]
  onGenerate?: () => void
  isGenerating?: boolean
  hasData: boolean
}

export default function PriorityMatrix({
  opportunities = [],
  issues = [],
  improvements = [],
  suggestions = [],
  onGenerate,
  isGenerating = false,
  hasData,
}: PriorityMatrixProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const { t } = useLocale()

  const QUADRANTS = [
    { key: 'opportunities', label: t('matrix.opportunities'), subtitle: t('matrix.opportunitiesSub'), color: B.success, icon: '\u26A1' },
    { key: 'issues', label: t('matrix.issues'), subtitle: t('matrix.issuesSub'), color: B.error, icon: '\uD83D\uDD34' },
    { key: 'improvements', label: t('matrix.improvements'), subtitle: t('matrix.improvementsSub'), color: B.chartCompetitors[0], icon: '\uD83D\uDCC8' },
    { key: 'suggestions', label: t('matrix.suggestions'), subtitle: t('matrix.suggestionsSub'), color: B.muted, icon: '\uD83D\uDCA1' },
  ] as const

  const dataMap: Record<string, MatrixItem[]> = {
    opportunities,
    issues,
    improvements,
    suggestions,
  }

  if (!hasData) {
    return (
      <div style={{
        background: B.surface,
        borderRadius: '12px',
        border: `1px solid ${B.border}`,
        padding: '32px',
        textAlign: 'center',
      }}>
        <h3 style={{
          fontFamily: B.fontMono,
          fontSize: '14px',
          fontWeight: 600,
          color: B.ink,
          marginBottom: '12px',
          textTransform: 'uppercase',
        }}>
          {t('matrix.title')}
        </h3>
        <p style={{ color: B.muted, fontSize: '13px', marginBottom: '16px' }}>
          {t('matrix.description')}
        </p>
        {onGenerate && (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            style={{
              padding: '10px 20px',
              background: isGenerating ? B.border : B.primary,
              color: isGenerating ? B.muted : B.bg,
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isGenerating ? 'default' : 'pointer',
            }}
          >
            {isGenerating ? t('matrix.generating') : t('matrix.generate')}
          </button>
        )}
      </div>
    )
  }

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
        {t('matrix.title')}
      </h3>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}>
        {QUADRANTS.map(q => (
          <div
            key={q.key}
            style={{
              background: B.bg,
              borderRadius: '10px',
              padding: '16px',
              border: `1px solid ${q.color}20`,
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}>
              <span style={{ fontSize: '16px' }}>{q.icon}</span>
              <div>
                <div style={{
                  fontFamily: B.fontMono,
                  fontSize: '12px',
                  fontWeight: 600,
                  color: q.color,
                }}>
                  {q.label}
                </div>
                <div style={{ fontSize: '10px', color: B.muted }}>{q.subtitle}</div>
              </div>
              <span style={{
                marginLeft: 'auto',
                fontSize: '11px',
                fontWeight: 600,
                color: q.color,
                background: `${q.color}15`,
                padding: '2px 6px',
                borderRadius: '4px',
              }}>
                {dataMap[q.key]?.length ?? 0}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {(dataMap[q.key] ?? []).map((item, i) => (
                <div
                  key={i}
                  onMouseEnter={() => setHovered(`${q.key}-${i}`)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: '8px 10px',
                    background: hovered === `${q.key}-${i}` ? B.surface2 : 'transparent',
                    borderRadius: '6px',
                    transition: 'background 0.2s',
                    cursor: 'default',
                  }}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: B.ink,
                    marginBottom: '2px',
                  }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: '11px', color: B.muted }}>
                    {item.driver} &bull; {t('matrix.impact')}: {item.impact_score}/10 &bull; {t('matrix.effort')}: {item.effort_score}/10
                  </div>
                  {hovered === `${q.key}-${i}` && (
                    <div style={{
                      fontSize: '11px',
                      color: B.muted,
                      marginTop: '4px',
                      lineHeight: '1.4',
                    }}>
                      {item.description}
                    </div>
                  )}
                </div>
              ))}
              {(dataMap[q.key] ?? []).length === 0 && (
                <div style={{ fontSize: '11px', color: B.border, fontStyle: 'italic', padding: '8px' }}>
                  {t('matrix.noItems')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
