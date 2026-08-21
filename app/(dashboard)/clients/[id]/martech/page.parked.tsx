'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import MartechGrid from '@/components/clients/MartechGrid'
import MartechEssentials from '@/components/clients/MartechEssentials'
import { MARTECH_CATEGORIES, AREA_LABELS } from '@/lib/martech/categories'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'

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

interface GapItem {
  category: string
  label: string
  severity: 'high' | 'medium' | 'low'
  description: string
}

interface Recommendation {
  priority: number
  title: string
  description: string
  category: string
}

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  complete: { bg: `${B.success}10`, text: B.success, border: `${B.success}30`, label: 'Complete' },
  good: { bg: `${B.info}10`, text: B.info, border: `${B.info}30`, label: 'Good' },
  partial: { bg: `${B.warning}10`, text: B.warning, border: `${B.warning}30`, label: 'Partial' },
  incomplete: { bg: `${B.error}10`, text: B.error, border: `${B.error}30`, label: 'Incomplete' },
}

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Basic': { bg: `${B.error}15`, text: B.error, border: `${B.error}40` },
  'Developing': { bg: `${B.warning}15`, text: B.warning, border: `${B.warning}40` },
  'Advanced': { bg: `${B.info}15`, text: B.info, border: `${B.info}40` },
  'Best-in-Class': { bg: `${B.success}15`, text: B.success, border: `${B.success}40` },
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  high: { bg: `${B.error}12`, text: B.error, dot: B.error },
  medium: { bg: `${B.warning}12`, text: B.warning, dot: B.warning },
  low: { bg: `${B.muted}12`, text: B.muted, dot: B.muted },
}

const DIAG_ICONS: Record<string, string> = {
  success: '✓',
  warning: '⚠',
  error: '✗',
  info: 'ℹ',
}

const DIAG_COLORS: Record<string, string> = {
  success: B.success,
  warning: B.warning,
  error: B.error,
  info: B.muted,
}

const CWV_SCORE_KEYS = ['performance_score', 'seo_score', 'accessibility_score', 'best_practices_score'] as const

function cwvScoresEmpty(d: Record<string, number> | null | undefined): boolean {
  if (!d) return true
  return CWV_SCORE_KEYS.every(k => !d[k])
}

function cwvNeedsBackfill(
  cwv: { mobile: Record<string, number> | null; desktop: Record<string, number> | null } | null | undefined,
): boolean {
  if (!cwv) return true
  return cwvScoresEmpty(cwv.mobile) || cwvScoresEmpty(cwv.desktop)
}

export default function ClientMartechPage() {
  const params = useParams()
  const clientId = params.id as string
  const { t } = useLocale()

  const [tools, setTools] = useState<MartechTool[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const [completeness, setCompleteness] = useState<CompletenessReport | null>(null)
  const [maturityScore, setMaturityScore] = useState<number | null>(null)
  const [maturityTier, setMaturityTier] = useState<string | null>(null)
  const [gapAnalysis, setGapAnalysis] = useState<GapItem[]>([])
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [cwv, setCwv] = useState<{
    mobile: Record<string, number> | null
    desktop: Record<string, number> | null
    analysis_date: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [cwvLoading, setCwvLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  // PR6: full grid + maturity + diagnostics + gap analysis + recommendations
  // are collapsed under "Mostra dettaglio completo" — the user asked us to
  // strip the noise and surface only the essentials.
  const [showFullStack, setShowFullStack] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await fetchMartech()
      if (cancelled || !data) return
      // The previously-saved stack renders instantly above. Only the live
      // Core Web Vitals backfill (a slow PageSpeed call) is deferred so it
      // never blocks first paint — kick it in the background if needed.
      if (data.domain && cwvNeedsBackfill(data.cwv)) {
        fetchCwvLive()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // Loads the cached MarTech snapshot. `skipLiveCwv=1` keeps it instant.
  // Pass { silent } to refresh in place (e.g. after a per-category rerun)
  // without blanking the page with the full-page loading state.
  async function fetchMartech(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech?skipLiveCwv=1`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setTools(data.martech || [])
      setDomain(data.domain || null)
      setCompleteness(data.completeness || null)
      setMaturityScore(data.maturityScore ?? null)
      setMaturityTier(data.maturityTier ?? null)
      setGapAnalysis(data.gapAnalysis || [])
      setRecommendations(data.recommendations || [])
      setCwv(data.cwv ?? null)
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data')
      return null
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  // Background-only: fills the CWV cards via the live PageSpeed path without
  // ever touching the page-level loading state.
  async function fetchCwvLive() {
    setCwvLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech`)
      const data = await res.json()
      if (res.ok && data.cwv) setCwv(data.cwv)
    } catch {
      /* best-effort — keep whatever the instant load showed */
    } finally {
      setCwvLoading(false)
    }
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
      setMaturityScore(data.maturityScore ?? null)
      setMaturityTier(data.maturityTier ?? null)
      setGapAnalysis(data.gapAnalysis || [])
      setRecommendations(data.recommendations || [])
      // CWV is keyed off the latest analysis — keep whatever fetchMartech got.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection error')
    }
    setDetecting(false)
  }

  const lastDetected = tools.length > 0
    ? new Date(Math.max(...tools.map(t => new Date(t.detected_at).getTime())))
    : null

  const uniqueCategories = new Set(tools.map(t => t.category))
  const uniqueAreas = new Set(
    MARTECH_CATEGORIES
      .filter(c => uniqueCategories.has(c.key))
      .map(c => c.area)
  )

  const avgConfidence = tools.length > 0
    ? tools.reduce((sum, t) => sum + t.confidence, 0) / tools.length
    : 0

  const tierStyle = maturityTier ? TIER_COLORS[maturityTier] || TIER_COLORS['Developing'] : null

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h3 style={{
            fontFamily: B.fontMono,
            fontSize: '16px',
            fontWeight: 700,
            color: B.ink,
            marginBottom: '4px',
          }}>
            {t('martech.title')}
          </h3>
          <p style={{ fontSize: '13px', color: B.muted }}>
            {tools.length > 0
              ? <>
                  <span style={{ color: B.primary, fontWeight: 600 }}>{tools.length}</span> {t('martech.toolsDetected')}
                  {' · '}
                  <span>{uniqueCategories.size} {t('martech.categories')}</span>
                  {' · '}
                  <span>{uniqueAreas.size} {t('martech.strategicAreas')}</span>
                  {' · '}
                  <span>{t('martech.avgConfidence')} {Math.round(avgConfidence * 100)}%</span>
                  {domain && <span style={{ color: B.muted }}>{' · '}{domain}</span>}
                </>
              : domain
                ? `${t('martech.analyzeStack')} ${domain}`
                : t('martech.configureDomain')
            }
            {lastDetected && (
              <span style={{ display: 'block', marginTop: '2px', color: B.muted, fontSize: '11px' }}>
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
            background: detecting || !domain ? B.border : B.primary,
            color: detecting || !domain ? B.muted : B.bg,
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: B.fontMono,
            cursor: detecting || !domain ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {detecting ? t('martech.analyzing') : tools.length > 0 ? t('martech.reAnalyze') : t('martech.detectStack')}
        </button>
      </div>

      {/* Compact, non-destructive progress strip for a full re-analyze.
          The existing data stays on screen (dimmed below) instead of being
          replaced by a full-page spinner. */}
      {detecting && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          background: B.surface,
          border: `1px solid ${B.primary}40`,
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '20px',
        }}>
          <span
            className="animate-spin"
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: `2px solid ${B.border}`,
              borderTopColor: B.primary,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '13px', fontWeight: 600, color: B.primary, fontFamily: B.fontMono }}>
            {t('martech.auditInProgress')}
          </span>
          <span style={{ fontSize: '12px', color: B.muted }}>
            {t('martech.auditSteps')}
          </span>
        </div>
      )}

      {/* PR6: Essentials — the only thing surfaced by default. Stays visible
          (dimmed) during a full re-analyze so the page never blanks out;
          per-category reruns refresh it silently in place. */}
      {!loading && tools.length > 0 && (
        <div style={{
          marginBottom: '20px',
          opacity: detecting ? 0.5 : 1,
          pointerEvents: detecting ? 'none' : 'auto',
          transition: 'opacity 0.2s',
        }}>
          <MartechEssentials
            tools={tools}
            cwv={cwv}
            cwvLoading={cwvLoading}
            clientId={clientId}
            onCategoryRefreshed={() => fetchMartech({ silent: true })}
          />
        </div>
      )}

      {/* PR6: full stack details collapsed behind a toggle.
          Everything below this only renders when the user opts in. */}
      {!loading && tools.length > 0 && (
        <button
          onClick={() => setShowFullStack(s => !s)}
          style={{
            background: 'transparent',
            border: `1px solid ${B.border}`,
            borderRadius: '8px',
            color: B.muted,
            padding: '8px 14px',
            fontSize: '11px',
            fontFamily: B.fontMono,
            cursor: 'pointer',
            marginBottom: '20px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          {showFullStack ? '▲ Nascondi dettaglio completo' : '▼ Mostra dettaglio completo (maturity, gap, full stack)'}
        </button>
      )}

      {/* Maturity Score + Completeness Row */}
      {showFullStack && maturityScore !== null && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '20px',
        }}>
          {/* Maturity Score Card */}
          <div style={{
            background: B.surface,
            borderRadius: '12px',
            border: `1px solid ${tierStyle?.border || B.border}`,
            padding: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* Score circle */}
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: B.fontMono,
                fontSize: '20px',
                fontWeight: 700,
                background: tierStyle?.bg || B.border,
                color: tierStyle?.text || B.muted,
                border: `3px solid ${tierStyle?.border || B.border}`,
                flexShrink: 0,
              }}>
                {maturityScore}
              </div>
              <div>
                <div style={{
                  fontFamily: B.fontMono,
                  fontSize: '14px',
                  fontWeight: 600,
                  color: B.ink,
                  marginBottom: '4px',
                }}>
                  {t('martech.maturityScore')}
                </div>
                <div style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: B.fontMono,
                  background: tierStyle?.bg || B.border,
                  color: tierStyle?.text || B.muted,
                  border: `1px solid ${tierStyle?.border || B.border}`,
                }}>
                  {maturityTier}
                </div>
                <div style={{ fontSize: '11px', color: B.muted, marginTop: '4px' }}>
                  {maturityScore <= 25 && t('martech.tierBasicDesc')}
                  {maturityScore > 25 && maturityScore <= 50 && t('martech.tierDevelopingDesc')}
                  {maturityScore > 50 && maturityScore <= 75 && t('martech.tierAdvancedDesc')}
                  {maturityScore > 75 && t('martech.tierBestDesc')}
                </div>
              </div>
            </div>
          </div>

          {/* Completeness Card */}
          {completeness && (
            <div style={{
              background: B.surface,
              borderRadius: '12px',
              border: `1px solid ${LEVEL_COLORS[completeness.level]?.border || B.border}`,
              padding: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: B.fontMono,
                  fontSize: '20px',
                  fontWeight: 700,
                  background: LEVEL_COLORS[completeness.level]?.bg || B.border,
                  color: LEVEL_COLORS[completeness.level]?.text || B.muted,
                  border: `3px solid ${LEVEL_COLORS[completeness.level]?.border || B.border}`,
                  flexShrink: 0,
                }}>
                  {completeness.score}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: B.fontMono,
                    fontSize: '14px',
                    fontWeight: 600,
                    color: B.ink,
                    marginBottom: '4px',
                  }}>
                    {t('martech.completeness')}
                  </div>
                  <div style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: B.fontMono,
                    background: LEVEL_COLORS[completeness.level]?.bg || B.border,
                    color: LEVEL_COLORS[completeness.level]?.text || B.muted,
                    border: `1px solid ${LEVEL_COLORS[completeness.level]?.border || B.border}`,
                  }}>
                    {LEVEL_COLORS[completeness.level]?.label || completeness.level}
                  </div>
                  <div style={{ fontSize: '11px', color: B.muted, marginTop: '4px' }}>
                    {completeness.pagesScanned} pages · {completeness.totalSignals} signals · {Math.round(completeness.signalQuality.htmlSize / 1024)}KB HTML
                  </div>
                </div>
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  style={{
                    padding: '6px 10px',
                    background: 'transparent',
                    border: `1px solid ${B.border}`,
                    borderRadius: '6px',
                    color: B.muted,
                    fontSize: '10px',
                    fontFamily: B.fontMono,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {showDiagnostics ? '▲' : '▼'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Diagnostics (collapsible) */}
      {showFullStack && showDiagnostics && completeness && completeness.diagnostics.length > 0 && (
        <div style={{
          background: B.bg,
          borderRadius: '8px',
          border: `1px solid ${B.border}`,
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}>
          <div style={{ fontSize: '11px', color: B.muted, fontFamily: B.fontMono, marginBottom: '4px', fontWeight: 600 }}>
            {t('martech.showDiagnostics')}
          </div>
          {completeness.diagnostics.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px' }}>
              <span style={{
                color: DIAG_COLORS[d.type] || B.muted,
                fontWeight: 700,
                flexShrink: 0,
                width: '14px',
                textAlign: 'center',
              }}>
                {DIAG_ICONS[d.type] || '·'}
              </span>
              <span style={{ color: B.ink, lineHeight: '1.4' }}>{d.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Gap Analysis */}
      {showFullStack && gapAnalysis.length > 0 && (
        <div style={{
          background: B.surface,
          borderRadius: '12px',
          border: `1px solid ${B.border}`,
          padding: '20px',
          marginBottom: '20px',
        }}>
          <h4 style={{
            fontFamily: B.fontMono,
            fontSize: '14px',
            fontWeight: 700,
            color: B.ink,
            marginBottom: '14px',
          }}>
            {t('martech.gapAnalysis')}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {gapAnalysis.map((gap, i) => {
              const sev = SEVERITY_COLORS[gap.severity] || SEVERITY_COLORS.low
              return (
                <div key={i} style={{
                  background: sev.bg,
                  borderRadius: '8px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}>
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: sev.dot,
                    flexShrink: 0,
                    marginTop: '5px',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{
                        fontFamily: B.fontMono,
                        fontSize: '13px',
                        fontWeight: 600,
                        color: sev.text,
                      }}>
                        {gap.label}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: B.bg,
                        color: B.muted,
                        fontFamily: B.fontMono,
                        textTransform: 'uppercase',
                      }}>
                        {gap.severity}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: B.muted, lineHeight: '1.5', margin: 0 }}>
                      {gap.description}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {showFullStack && recommendations.length > 0 && (
        <div style={{
          background: B.surface,
          borderRadius: '12px',
          border: `1px solid ${B.border}`,
          padding: '20px',
          marginBottom: '20px',
        }}>
          <h4 style={{
            fontFamily: B.fontMono,
            fontSize: '14px',
            fontWeight: 700,
            color: B.ink,
            marginBottom: '14px',
          }}>
            {t('martech.recommendations')}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recommendations.map((rec, i) => (
              <div key={i} style={{
                background: B.bg,
                borderRadius: '8px',
                padding: '14px 16px',
                borderLeft: `3px solid ${rec.priority <= 2 ? B.primary : rec.priority <= 3 ? B.info : B.muted}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: rec.priority <= 2 ? B.primarySoft : rec.priority <= 3 ? `${B.info}20` : `${B.muted}20`,
                    color: rec.priority <= 2 ? B.primary : rec.priority <= 3 ? B.info : B.muted,
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: B.fontMono,
                    flexShrink: 0,
                  }}>
                    {rec.priority}
                  </span>
                  <span style={{
                    fontFamily: B.fontMono,
                    fontSize: '13px',
                    fontWeight: 600,
                    color: B.ink,
                  }}>
                    {rec.title}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: B.muted, lineHeight: '1.5', margin: 0, paddingLeft: '32px' }}>
                  {rec.description}
                </p>
              </div>
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
          color: B.error,
          fontSize: '13px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ color: B.muted, textAlign: 'center', padding: '60px 0' }}>
          {t('common.loading')}...
        </div>
      ) : tools.length === 0 && !detecting ? (
        <div style={{
          background: B.surface,
          borderRadius: '12px',
          border: `1px solid ${B.border}`,
          padding: '40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</div>
          <h4 style={{
            fontFamily: B.fontMono,
            fontSize: '16px',
            fontWeight: 600,
            color: B.primary,
            marginBottom: '8px',
          }}>
            {t('martech.noTechDetected')}
          </h4>
          <p style={{ fontSize: '13px', color: B.muted, maxWidth: '500px', margin: '0 auto 16px' }}>
            {domain ? t('martech.clickDetect') : t('martech.configureDomainFirst')}
          </p>
        </div>
      ) : showFullStack ? (
        <MartechGrid tools={tools} />
      ) : null}
    </div>
  )
}
