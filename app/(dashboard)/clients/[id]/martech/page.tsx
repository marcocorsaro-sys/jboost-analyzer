'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import MartechGrid from '@/components/clients/MartechGrid'
import { MARTECH_CATEGORIES, AREA_LABELS } from '@/lib/martech/categories'
import { useLocale } from '@/lib/i18n'

interface MartechTool {
  id: string
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
  details: Record<string, unknown> | null
  detected_at: string
}

interface CompletenessReport {
  score: number
  level: 'complete' | 'good' | 'partial' | 'incomplete'
  pagesScanned: number
  totalSignals: number
  diagnostics: Array<{
    type: 'success' | 'warning' | 'error' | 'info'
    message: string
  }>
  signalQuality: {
    scripts: number
    links: number
    metas: number
    htmlSize: number
    jsonLd: number
    preconnects: number
    noscripts: number
    iframes: number
    dataAttributes: number
  }
}

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  complete: { bg: '#22c55e10', text: '#22c55e', border: '#22c55e30', label: 'Complete' },
  good: { bg: '#38bdf810', text: '#38bdf8', border: '#38bdf830', label: 'Good' },
  partial: { bg: '#f59e0b10', text: '#f59e0b', border: '#f59e0b30', label: 'Partial' },
  incomplete: { bg: '#ef444410', text: '#ef4444', border: '#ef444430', label: 'Incomplete' },
}

const DIAG_ICONS: Record<string, string> = {
  success: '✓',
  warning: '⚠',
  error: '✗',
  info: 'ℹ',
}

const DIAG_COLORS: Record<string, string> = {
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#6b7280',
}

export default function ClientMartechPage() {
  const params = useParams()
  const clientId = params.id as string
  const { t } = useLocale()

  const [tools, setTools] = useState<MartechTool[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const [completeness, setCompleteness] = useState<CompletenessReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  useEffect(() => {
    fetchMartech()
  }, [clientId])

  async function fetchMartech() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setTools(data.martech || [])
      setDomain(data.domain || null)
      setCompleteness(data.completeness || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data')
    }
    setLoading(false)
  }

  async function runDetection() {
    setDetecting(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Detection failed')
      setTools(data.martech || [])
      setDomain(data.domain || null)
      setCompleteness(data.completeness || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection error')
    }
    setDetecting(false)
  }

  const lastDetected = tools.length > 0
    ? new Date(Math.max(...tools.map(t => new Date(t.detected_at).getTime())))
    : null

  // Count categories with tools
  const uniqueCategories = new Set(tools.map(t => t.category))
  const uniqueAreas = new Set(
    MARTECH_CATEGORIES
      .filter(c => uniqueCategories.has(c.key))
      .map(c => c.area)
  )

  // Average confidence
  const avgConfidence = tools.length > 0
    ? tools.reduce((sum, t) => sum + t.confidence, 0) / tools.length
    : 0

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            marginBottom: '4px',
          }}>
            {t('martech.title')}
          </h3>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            {tools.length > 0
              ? <>
                  <span style={{ color: '#c8e64a', fontWeight: 600 }}>{tools.length}</span> {t('martech.toolsDetected')}
                  {' · '}
                  <span>{uniqueCategories.size} {t('martech.categories')}</span>
                  {' · '}
                  <span>{uniqueAreas.size} {t('martech.strategicAreas')}</span>
                  {' · '}
                  <span>{t('martech.avgConfidence')} {Math.round(avgConfidence * 100)}%</span>
                  {domain && <span style={{ color: '#4b5563' }}>{' · '}{domain}</span>}
                </>
              : domain
                ? `${t('martech.analyzeStack')} ${domain}`
                : t('martech.configureDomain')
            }
            {lastDetected && (
              <span style={{ display: 'block', marginTop: '2px', color: '#4b5563', fontSize: '11px' }}>
                {t('martech.lastScan')}: {lastDetected.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })}
                {' — '}
                {lastDetected.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={runDetection}
          disabled={detecting || !domain}
          style={{
            padding: '8px 16px',
            background: detecting || !domain ? '#2a2d35' : '#c8e64a',
            color: detecting || !domain ? '#6b7280' : '#111318',
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: detecting || !domain ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {detecting ? t('martech.analyzing') : tools.length > 0 ? t('martech.reAnalyze') : t('martech.detectStack')}
        </button>
      </div>

      {/* Completeness Report */}
      {completeness && !detecting && (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: `1px solid ${LEVEL_COLORS[completeness.level]?.border || '#2a2d35'}`,
          padding: '16px 20px',
          marginBottom: '20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: showDiagnostics ? '12px' : '0' }}>
            {/* Score circle */}
            <div style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '16px',
              fontWeight: 700,
              background: LEVEL_COLORS[completeness.level]?.bg || '#2a2d35',
              color: LEVEL_COLORS[completeness.level]?.text || '#6b7280',
              border: `2px solid ${LEVEL_COLORS[completeness.level]?.border || '#2a2d35'}`,
              flexShrink: 0,
            }}>
              {completeness.score}
            </div>

            {/* Info */}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '13px',
                  fontWeight: 600,
                  color: LEVEL_COLORS[completeness.level]?.text || '#6b7280',
                }}>
                  {t('martech.completeness')}: {LEVEL_COLORS[completeness.level]?.label || completeness.level}
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#4b5563',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {completeness.pagesScanned} {completeness.pagesScanned === 1 ? 'page' : 'pages'} scanned · {completeness.totalSignals} signals
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#6b7280' }}>
                <span>{completeness.signalQuality.scripts} scripts</span>
                <span>{completeness.signalQuality.links} links</span>
                <span>{completeness.signalQuality.metas} metas</span>
                <span>{completeness.signalQuality.jsonLd} JSON-LD</span>
                <span>{completeness.signalQuality.iframes} iframes</span>
                <span>{Math.round(completeness.signalQuality.htmlSize / 1024)}KB HTML</span>
              </div>
            </div>

            {/* Toggle diagnostics */}
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid #2a2d35',
                borderRadius: '6px',
                color: '#9ca3af',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {showDiagnostics ? t('martech.hideDiagnostics') : t('martech.showDiagnostics')}
            </button>
          </div>

          {/* Diagnostics list */}
          {showDiagnostics && completeness.diagnostics.length > 0 && (
            <div style={{
              background: '#111318',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              {completeness.diagnostics.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px' }}>
                  <span style={{
                    color: DIAG_COLORS[d.type] || '#6b7280',
                    fontWeight: 700,
                    flexShrink: 0,
                    width: '14px',
                    textAlign: 'center',
                  }}>
                    {DIAG_ICONS[d.type] || '·'}
                  </span>
                  <span style={{ color: '#d1d5db', lineHeight: '1.4' }}>{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detecting spinner */}
      {detecting && (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '40px',
          textAlign: 'center',
          marginBottom: '20px',
        }}>
          <div style={{
            fontSize: '14px',
            color: '#c8e64a',
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: '8px',
          }}>
            {t('martech.auditInProgress')}
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', maxWidth: '600px', margin: '0 auto' }}>
            {t('martech.auditSteps')}
          </p>
          <div style={{
            marginTop: '16px',
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
          }}>
            {['Fetching pages...', 'Extracting signals...', 'AI classification...', 'Validating completeness...'].map((step, i) => (
              <span key={i} style={{
                padding: '4px 10px',
                background: '#111318',
                borderRadius: '4px',
                fontSize: '10px',
                color: '#6b7280',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {step}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '13px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '60px 0' }}>
          {t('common.loading')}...
        </div>
      ) : tools.length === 0 && !detecting ? (
        <div style={{
          background: '#1a1c24',
          borderRadius: '12px',
          border: '1px solid #2a2d35',
          padding: '40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</div>
          <h4 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            fontWeight: 600,
            color: '#c8e64a',
            marginBottom: '8px',
          }}>
            {t('martech.noTechDetected')}
          </h4>
          <p style={{ fontSize: '13px', color: '#6b7280', maxWidth: '500px', margin: '0 auto 16px' }}>
            {domain ? t('martech.clickDetect') : t('martech.configureDomainFirst')}
          </p>
        </div>
      ) : (
        <MartechGrid tools={tools} />
      )}
    </div>
  )
}
