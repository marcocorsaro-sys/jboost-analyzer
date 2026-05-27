'use client'

import { useState } from 'react'

// "Fotografia MarTech solida": 5 big cards — CMS, Web Analytics,
// MKT Automation, Core Web Vitals Desktop, Core Web Vitals Mobile.
// Each category card has a "↻" rerun icon that hits the per-category
// refresh endpoint (faster + far more reliable than the full pipeline).

interface MartechTool {
  id: string
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
}

interface CwvData {
  performance_score?: number
  accessibility_score?: number
  seo_score?: number
  best_practices_score?: number
}

interface MartechEssentialsProps {
  tools: MartechTool[]
  /** Client id, required for the per-category rerun call. */
  clientId?: string
  /** Called after a successful category rerun so the parent can refresh. */
  onCategoryRefreshed?: () => void
  /** True while the live Core Web Vitals backfill is in flight. */
  cwvLoading?: boolean
  cwv: {
    mobile: CwvData | null
    desktop: CwvData | null
    analysis_date: string | null
  } | null
}

const ESSENTIAL_CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'cms', label: 'CMS', hint: 'Content Management / DXP' },
  { key: 'analytics', label: 'Web Analytics', hint: 'Web Analytics & BI' },
  { key: 'marketing_automation', label: 'MKT Automation', hint: 'Lead Nurturing & Campaigns' },
]

function scoreColor(score: number | undefined | null): string {
  if (score === null || score === undefined) return '#6b7280'
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#38bdf8'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

function scoreLabel(score: number | undefined | null): string {
  if (score === null || score === undefined) return '—'
  return String(Math.round(score))
}

function CategoryCard({
  categoryKey,
  label,
  hint,
  tools,
  clientId,
  onRefreshed,
}: {
  categoryKey: string
  label: string
  hint: string
  tools: MartechTool[]
  clientId?: string
  onRefreshed?: () => void
}) {
  const sorted = [...tools].sort((a, b) => b.confidence - a.confidence)
  const primary = sorted[0] ?? null
  const others = sorted.slice(1, 4)

  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  async function handleRefresh(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!clientId) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/martech/category-refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: categoryKey }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onRefreshed?.()
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'rerun failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div style={{
      background: '#1a1c24',
      borderRadius: '14px',
      border: `1px solid ${refreshError ? '#ef4444' : '#2a2d35'}`,
      padding: '28px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      minHeight: '220px',
      position: 'relative',
      opacity: refreshing ? 0.6 : 1,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '11px',
          fontWeight: 700,
          color: '#c8e64a',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
        }}>
          {label}
        </div>
        {clientId && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title={refreshing ? 'Sto rilanciando…' : `Rilancia solo ${label} (non ricarica la pagina)`}
            aria-label={`Rilancia ${label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: refreshing ? '#2a2d35' : '#c8e64a14',
              border: `1px solid ${refreshing ? '#2a2d35' : '#c8e64a55'}`,
              borderRadius: '6px',
              color: refreshing ? '#6b7280' : '#c8e64a',
              padding: '5px 10px',
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              cursor: refreshing ? 'default' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <span className={refreshing ? 'animate-spin' : undefined} style={{ display: 'inline-block', fontSize: '13px', lineHeight: 1 }}>↻</span>
            {refreshing ? 'Rilancio…' : 'Rilancia'}
          </button>
        )}
      </div>

      {primary ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '40px',
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-1px',
            lineHeight: '1.05',
            wordBreak: 'break-word',
          }}>
            {primary.tool_name}
          </div>
          {primary.tool_version && (
            <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace" }}>
              v{primary.tool_version}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '40px',
          fontWeight: 700,
          color: '#4b5563',
          letterSpacing: '-1px',
          lineHeight: '1.05',
        }}>
          —
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ fontSize: '12px', color: '#6b7280' }}>
        {primary
          ? `${Math.round(primary.confidence * 100)}% confidence · ${hint}`
          : hint}
      </div>
      {others.length > 0 && (
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
          + {others.map(t => t.tool_name).join(', ')}
        </div>
      )}
    </div>
  )
}

function CwvCard({
  label,
  data,
  loading = false,
}: {
  label: 'Mobile' | 'Desktop'
  data: CwvData | null
  loading?: boolean
}) {
  const perf = data?.performance_score ?? null
  const seo = data?.seo_score ?? null
  const a11y = data?.accessibility_score ?? null
  const bp = data?.best_practices_score ?? null
  const overall = perf ?? null

  // "Unavailable" = no data row at all (data is null). "Stale/mock" = data
  // exists but all four scores are 0 (PSI key missing during the analysis
  // run, or all categories failed). Both surface as a clear text hint instead
  // of a misleading "0" big number.
  const noData = data === null
  const allZero = !noData && [perf, seo, a11y, bp].every(v => v === 0)
  const showFallback = noData || allZero

  return (
    <div style={{
      background: '#1a1c24',
      borderRadius: '14px',
      border: `1px solid ${showFallback ? '#3a3d45' : scoreColor(overall) + '40'}`,
      padding: '28px',
      display: 'flex',
      flexDirection: 'column',
      gap: '18px',
      minHeight: '220px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '11px',
        fontWeight: 700,
        color: '#c8e64a',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
      }}>
        Core Web Vitals · {label}
        {loading && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#6b7280', fontWeight: 600, letterSpacing: 0 }}>
            <span className="animate-spin" style={{
              width: 10, height: 10, borderRadius: '50%',
              border: '2px solid #2a2d35', borderTopColor: '#c8e64a',
              display: 'inline-block',
            }} />
            aggiorno…
          </span>
        )}
      </div>

      {showFallback ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '72px',
            fontWeight: 700,
            color: '#4b5563',
            lineHeight: '1',
            letterSpacing: '-2px',
          }}>
            —
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', lineHeight: '1.4' }}>
            {loading
              ? `Recupero i Core Web Vitals ${label.toLowerCase()} da PageSpeed…`
              : noData
                ? `Dato ${label.toLowerCase()} non presente nell'ultima analisi. Rilancia un'analisi per popolarlo.`
                : `PSI ha restituito 0 su tutte le categorie. Verifica GOOGLE_PSI_API_KEY in /admin > Integrations.`}
          </div>
        </div>
      ) : (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '72px',
          fontWeight: 700,
          color: scoreColor(overall),
          lineHeight: '1',
          letterSpacing: '-2px',
        }}>
          {scoreLabel(overall)}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '8px',
        fontSize: '12px',
        paddingTop: '12px',
        borderTop: '1px solid #2a2d35',
      }}>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>SEO</div>
          <div style={{ color: scoreColor(seo), fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px' }}>{scoreLabel(seo)}</div>
        </div>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>A11Y</div>
          <div style={{ color: scoreColor(a11y), fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px' }}>{scoreLabel(a11y)}</div>
        </div>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>Best Pr.</div>
          <div style={{ color: scoreColor(bp), fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px' }}>{scoreLabel(bp)}</div>
        </div>
      </div>
    </div>
  )
}

export default function MartechEssentials({ tools, cwv, cwvLoading = false, clientId, onCategoryRefreshed }: MartechEssentialsProps) {
  const byCategory: Record<string, MartechTool[]> = {}
  for (const t of tools) {
    if (!t?.category) continue
    if (!byCategory[t.category]) byCategory[t.category] = []
    byCategory[t.category].push(t)
  }

  const desktopMissing = !cwv?.desktop && !!cwv?.mobile

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '14px',
      }}>
        {ESSENTIAL_CATEGORIES.map(cat => (
          <CategoryCard
            key={cat.key}
            categoryKey={cat.key}
            label={cat.label}
            hint={cat.hint}
            tools={byCategory[cat.key] ?? []}
            clientId={clientId}
            onRefreshed={onCategoryRefreshed}
          />
        ))}

        <CwvCard label="Desktop" data={cwv?.desktop ?? null} loading={cwvLoading} />
        <CwvCard label="Mobile" data={cwv?.mobile ?? null} loading={cwvLoading} />
      </div>

      {desktopMissing && (
        <div style={{
          padding: '10px 14px',
          background: '#1a1c24',
          borderRadius: '8px',
          border: '1px solid #2a2d35',
          fontSize: '11px',
          color: '#6b7280',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          ℹ Il dato Desktop non è ancora presente — verrà popolato al prossimo run di analisi.
        </div>
      )}

      {cwv?.analysis_date && (
        <div style={{
          fontSize: '10px',
          color: '#4b5563',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.5px',
        }}>
          CWV da analisi completata il {new Date(cwv.analysis_date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
      )}
    </div>
  )
}
