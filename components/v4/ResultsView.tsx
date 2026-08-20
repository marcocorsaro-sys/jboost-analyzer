'use client'

/**
 * V4 — Audit Results shell (UX-UI Bibbia sheets 3/6).
 *
 * Horizontal tab navigation: Overview · one tab per ACTIVE driver in
 * Business-first UI order (registry uiOrder) · Executive Summary. The
 * Overview holds the panoramic RADAR (per-driver competitor comparison is a
 * HISTOGRAM inside each driver tab) with the Absolute/Relative toggle:
 * Absolute shows only drivers with an intrinsic 0-100 (6 Development + AI
 * Visibility), the 3 relative-only Business drivers appear in Relative only.
 *
 * Async transparency: the page never blocks. While drivers run, it polls
 * /status every 5s; completed tabs are browsable. A failed driver shows the
 * failure and the reason from the source — never a 0, never a blank card.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { useLocale } from '@/lib/i18n'
import { driversInUiOrder, getV4Driver } from '@/lib/scoring/registry'
import type { DriverRow, StatusResponse } from './RunProgress'
import { STATUS_STYLE, fmt } from './RunProgress'
import DriverPanel, { type ScoreView } from './DriverPanel'
import ExecutiveSummaryTab from './ExecutiveSummaryTab'
import OutputPreviewTab from './OutputPreviewTab'
import PublishDialog from './PublishDialog'
import SwitchToClientButton from '@/components/audits/SwitchToClientButton'
import { ControllerChip, ControllerPanel, type ControllerResponse } from './ControllerPanel'
import type { EditsResponse, InsightsResponse, SiteMeta } from './results-shared'
import { card, mutedLabel, pill, primaryButton, ghostButton, scoreColor, fill, MEASURE_LABEL_KEY } from './results-shared'
import { B } from '@/lib/brand'

// recharts radar reused from V1, in its own lazy chunk (V1 pattern).
const SpiderChart = nextDynamic(() => import('@/components/analyzer/SpiderChart'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 444, background: B.surface, borderRadius: '12px', border: `1px solid ${B.border}` }} aria-hidden />
  ),
})

interface V4StatusResponse extends StatusResponse {
  domain?: string | null
  brandName?: string | null
  /** Client tied to this audit (promotion or wizard pick), null = prospect. */
  clientId?: string | null
  sites?: SiteMeta[]
}

type TabKey = 'overview' | 'summary' | string

export default function ResultsView({ analysisId }: { analysisId: string }) {
  const { t } = useLocale()

  const [status, setStatus] = useState<V4StatusResponse | null>(null)
  const [insights, setInsights] = useState<InsightsResponse | null>(null)
  const [editsInfo, setEditsInfo] = useState<EditsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [view, setView] = useState<ScoreView>('relative')
  const [overlay, setOverlay] = useState(true)
  const [publishOpen, setPublishOpen] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // ----------------------------------------------------------------- data --
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/status`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) {
        setLoadError(body.error ?? `errore ${res.status}`)
        return
      }
      setStatus(body as V4StatusResponse)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'network error')
    }
  }, [analysisId])

  const loadInsights = useCallback(async () => {
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/insights`, { cache: 'no-store' })
      if (res.ok) setInsights((await res.json()) as InsightsResponse)
    } catch {
      /* insights are progressive enhancement; status errors are the loud ones */
    }
  }, [analysisId])

  const loadEdits = useCallback(async () => {
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/publish`, { cache: 'no-store' })
      if (res.ok) setEditsInfo((await res.json()) as EditsResponse)
    } catch {
      /* ditto */
    }
  }, [analysisId])

  // Controller: the deterministic reviewer. Recomputed server-side on every
  // GET (nothing persisted), so refreshing after each loadAll keeps the chip
  // honest about the CURRENT set — the zara.it lesson.
  const [controller, setController] = useState<ControllerResponse | null>(null)
  const [controllerOpen, setControllerOpen] = useState(false)
  const [controllerLoading, setControllerLoading] = useState(false)
  const [controllerError, setControllerError] = useState<string | null>(null)

  const loadController = useCallback(async () => {
    setControllerLoading(true)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/controller`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) {
        setControllerError(body.error ?? `errore ${res.status}`)
        return
      }
      setController(body as ControllerResponse)
      setControllerError(null)
    } catch (err) {
      setControllerError(err instanceof Error ? err.message : 'network error')
    } finally {
      setControllerLoading(false)
    }
  }, [analysisId])

  const loadAll = useCallback(async () => {
    await Promise.all([loadStatus(), loadInsights(), loadEdits(), loadController()])
  }, [loadStatus, loadInsights, loadEdits, loadController])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Poll drivers while something is pending.
  useEffect(() => {
    if (!status || status.progress.complete) return
    const timer = setInterval(loadStatus, 5000)
    return () => clearInterval(timer)
  }, [status, loadStatus])

  // Poll insights while the LLM orchestration runs.
  useEffect(() => {
    if (insights?.insightsStatus !== 'running') return
    const timer = setInterval(loadInsights, 5000)
    return () => clearInterval(timer)
  }, [insights?.insightsStatus, loadInsights])

  const insightsRunning = insights?.insightsStatus === 'running'

  const generateInsights = useCallback(async () => {
    setGenError(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/insights`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setGenError(body.error ?? `errore ${res.status}`)
        return
      }
      setInsights((prev) =>
        prev ? { ...prev, insightsStatus: 'running', insightsError: null } : prev,
      )
      await loadInsights()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'network error')
    }
  }, [analysisId, loadInsights])

  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)

  // "Rilancia analisi": reset + redispatch of error/stuck-queued drivers,
  // without recreating the analysis. Done rows, edits and pauses survive.
  const retryFailed = useCallback(async () => {
    setRetrying(true)
    setRetryNote(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/retry`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok && res.status !== 207) {
        setRetryNote(body.error ?? `errore ${res.status}`)
      } else if (Array.isArray(body.dispatchErrors) && body.dispatchErrors.length > 0) {
        setRetryNote(body.dispatchErrors.join(' | '))
      } else if (Array.isArray(body.retried) && body.retried.length === 0) {
        setRetryNote(body.message ?? null)
      }
      await loadStatus()
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : 'network error')
    } finally {
      setRetrying(false)
    }
  }, [analysisId, loadStatus])

  const startPending = useCallback(async () => {
    if (!status) return
    setStarting(true)
    try {
      await fetch(`/api/v4/analyses/${analysisId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drivers: status.drivers.filter((d) => d.enabled).map((d) => d.driver_key),
        }),
      })
      await loadStatus()
    } finally {
      setStarting(false)
    }
  }, [analysisId, status, loadStatus])

  // ------------------------------------------------------------- derived --
  const enabledRows = useMemo(() => {
    if (!status) return []
    const order = (key: string) => getV4Driver(key)?.uiOrder ?? 99
    return status.drivers.filter((d) => d.enabled).sort((a, b) => order(a.driver_key) - order(b.driver_key))
  }, [status])

  const sites: SiteMeta[] = status?.sites ?? []
  const insightByDriver = useMemo(() => {
    const map = new Map<string, InsightsResponse['drivers'][number]['insight']>()
    for (const d of insights?.drivers ?? []) map.set(d.driver_key, d.insight)
    return map
  }, [insights])

  const drafts = editsInfo?.drafts ?? 0

  // Audit state pill: running > needs_decision > draft > published.
  const auditState: { key: string; color: string } = useMemo(() => {
    if (!status) return { key: 'v4res.state_draft', color: B.muted }
    if (status.progress.pending > 0) return { key: 'v4res.state_running', color: B.teal }
    if (status.progress.needs_decision > 0) return { key: 'v4res.state_needs_decision', color: B.warning }
    if (drafts > 0) return { key: 'v4res.state_draft', color: B.warning }
    if (editsInfo?.lastPublishedAt) return { key: 'v4res.state_published', color: B.primary }
    return { key: 'v4res.state_draft', color: B.muted }
  }, [status, drafts, editsInfo])

  // ------------------------------------------------------------- renders --
  if (loadError) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: `${B.error}20`,
          border: `1px solid ${B.error}`,
          borderRadius: '8px',
          color: B.error,
          fontSize: '13px',
        }}
      >
        {loadError}
      </div>
    )
  }

  if (!status) {
    return <div style={{ color: B.muted, fontSize: '14px' }}>{t('v4res.loading')}</div>
  }

  const { progress } = status
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: t('v4res.tab_overview') },
    ...enabledRows.map((d) => ({
      key: d.driver_key as TabKey,
      label: getV4Driver(d.driver_key)?.label ?? d.driver_key,
    })),
    { key: 'summary', label: t('v4res.tab_summary') },
    { key: 'output', label: t('v4export.tab') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* ------------------------------------------------------- header --- */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={mutedLabel}>{t('v4res.title')}</div>
          <div style={{ fontSize: '17px', fontWeight: 700, color: B.ink }}>{status.domain ?? analysisId}</div>
        </div>
        <span style={pill(auditState.color)}>
          {t(auditState.key as Parameters<typeof t>[0])}
        </span>
        {/* Promotion — the audit (prospect) becomes a client, or shows the
            client it already belongs to. Same island as /audits. */}
        <SwitchToClientButton
          analysisId={analysisId}
          auditName={status.brandName || status.domain || analysisId}
          clientId={status.clientId ?? null}
        />
        <ControllerChip
          data={controller}
          open={controllerOpen}
          onToggle={() => setControllerOpen((v) => !v)}
        />
        {progress.error > 0 && (
          <span style={pill(B.error)}>
            {progress.error} {t('v4res.state_error')}
          </span>
        )}
        {(progress.error > 0 || progress.pending > 0) && (
          <button
            type="button"
            onClick={retryFailed}
            disabled={retrying}
            style={{ ...ghostButton, borderColor: B.error, color: retrying ? B.muted : B.error }}
            title={t('v4res.retry_hint')}
          >
            {retrying ? t('v4res.retrying') : t('v4res.retry')}
          </button>
        )}
        {retryNote && <span style={{ fontSize: '12px', color: B.warning }}>{retryNote}</span>}

        {/* Absolute / Relative toggle (default Relative — sheet 6 v5). */}
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          {(['relative', 'absolute'] as ScoreView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                ...ghostButton,
                borderColor: view === v ? B.primary : B.border,
                color: view === v ? B.primary : B.muted,
              }}
            >
              {t(v === 'relative' ? 'v4res.view_relative' : 'v4res.view_absolute')}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPublishOpen(true)}
          disabled={progress.pending > 0}
          style={primaryButton(progress.pending === 0)}
          title={progress.pending > 0 ? t('v4res.publish_blocked_running') : undefined}
        >
          {t('v4res.save_publish')}
        </button>
        <span style={{ fontSize: '12px', color: drafts > 0 ? B.warning : B.muted }}>
          {drafts > 0 ? `${drafts} ${t('v4res.drafts_pending')}` : t('v4res.no_drafts')}
        </span>
        <span style={{ fontSize: '11px', color: B.muted }}>
          {t('v4res.refdate')} {status.refDate ?? '—'}
        </span>
      </div>

      {/* Controller findings panel (inline, toggled by the header chip). */}
      {controllerOpen && (
        <ControllerPanel
          data={controller}
          loading={controllerLoading}
          error={controllerError}
          onRecheck={loadController}
        />
      )}

      {/* ------------------------------------------------------- tab bar -- */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const row = enabledRows.find((d) => d.driver_key === tab.key)
          const statusColor = row ? STATUS_STYLE[row.status].color : null
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                ...ghostButton,
                padding: '8px 16px',
                fontFamily: B.fontMono,
                borderColor: active ? B.primary : B.border,
                color: active ? B.primary : B.muted,
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
              }}
            >
              {tab.label}
              {row && row.status !== 'done' && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor ?? B.muted }} />
              )}
              {row?.edited && <span style={{ color: B.warning }}>✎</span>}
            </button>
          )
        })}
      </div>

      {genError && (
        <div style={{ fontSize: '12px', color: B.error }}>
          {t('v4res.insights_error')}: {genError}
        </div>
      )}
      {insights?.insightsError && !insightsRunning && (
        <div style={{ fontSize: '12px', color: B.warning }}>{insights.insightsError}</div>
      )}

      {/* ------------------------------------------------------- content -- */}
      {activeTab === 'overview' && (
        <OverviewTab
          rows={enabledRows}
          sites={sites}
          view={view}
          overlay={overlay}
          onOverlay={setOverlay}
          progress={progress}
          starting={starting}
          onStartPending={startPending}
          onOpenDriver={(key) => setActiveTab(key)}
          insightByDriver={insightByDriver}
        />
      )}

      {activeTab === 'summary' && (
        <ExecutiveSummaryTab
          record={insights?.executiveSummary ?? null}
          insightsRunning={insightsRunning}
          onGenerate={generateInsights}
        />
      )}

      {activeTab === 'output' && (
        <OutputPreviewTab
          analysisId={analysisId}
          anyDriverDone={enabledRows.some((r) => r.status === 'done')}
        />
      )}

      {enabledRows.map(
        (row) =>
          activeTab === row.driver_key && (
            <DriverPanel
              key={row.driver_key}
              analysisId={analysisId}
              row={row}
              view={view}
              sites={sites}
              insight={insightByDriver.get(row.driver_key) ?? null}
              insightsRunning={insightsRunning}
              onGenerateInsights={generateInsights}
              onChanged={loadAll}
            />
          ),
      )}

      {publishOpen && editsInfo && (
        <PublishDialog
          analysisId={analysisId}
          editsInfo={editsInfo}
          onClose={() => setPublishOpen(false)}
          onPublished={loadAll}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview tab: radar + score cards / quick anchors.
// ---------------------------------------------------------------------------

function OverviewTab({
  rows,
  sites,
  view,
  overlay,
  onOverlay,
  progress,
  starting,
  onStartPending,
  onOpenDriver,
  insightByDriver,
}: {
  rows: DriverRow[]
  sites: SiteMeta[]
  view: ScoreView
  overlay: boolean
  onOverlay: (v: boolean) => void
  progress: StatusResponse['progress']
  starting: boolean
  onStartPending: () => void
  onOpenDriver: (key: string) => void
  insightByDriver: Map<string, InsightsResponse['drivers'][number]['insight']>
}) {
  const { t } = useLocale()

  // Absolute view charts only drivers that HAVE an absolute score
  // (6 Development + AI Visibility); relative-only drivers are excluded
  // from the radar in that view, with a note (sheet 6 v5).
  const inView = rows.filter((r) => (view === 'absolute' ? getV4Driver(r.driver_key)?.hasAbsoluteView : true))
  const excluded = rows.filter((r) => view === 'absolute' && !getV4Driver(r.driver_key)?.hasAbsoluteView)

  const labels = Object.fromEntries(inView.map((r) => [r.driver_key, getV4Driver(r.driver_key)?.label ?? r.driver_key]))

  const clientScores: Record<string, number | null> = Object.fromEntries(
    inView.map((r) => [r.driver_key, view === 'absolute' ? r.score_absolute : r.score_relative]),
  )

  const competitorScores = overlay
    ? sites
        .filter((s) => !s.is_client)
        .map((siteMeta) => ({
          domain: siteMeta.name,
          scores: Object.fromEntries(
            inView.map((r) => {
              const s = r.sites.find((x) => x.site_ref === siteMeta.site_ref)
              const value = view === 'absolute' ? (s?.score_absolute ?? null) : (s?.score_relative ?? null)
              return [r.driver_key, value]
            }),
          ) as Record<string, number | null>,
        }))
    : []

  const anyScore = Object.values(clientScores).some((v) => v !== null && v !== undefined)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {progress.total === 0 && (
        <div style={{ ...card, color: B.muted, fontSize: '14px' }}>{t('v4res.no_jobs')}</div>
      )}

      {progress.total > 0 && progress.pending === 0 && !progress.complete && (
        <button
          type="button"
          onClick={onStartPending}
          disabled={starting}
          style={{ ...primaryButton(!starting), alignSelf: 'flex-start' }}
        >
          {starting ? t('v4res.starting') : t('v4res.start_pending')}
        </button>
      )}

      {progress.pending > 0 && (
        <div style={{ fontSize: '12px', color: B.muted }}>{t('v4res.autorefresh')}</div>
      )}

      {/* Panoramic radar. */}
      {anyScore ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SpiderChart
            driverScores={clientScores}
            competitorScores={competitorScores}
            labels={labels}
            title={`${t('v4res.radar_title')} · ${t(view === 'absolute' ? 'v4res.view_absolute' : 'v4res.view_relative')}`}
            strictNulls
            primaryName={sites.find((s) => s.is_client)?.name ?? t('v4res.radar_client')}
          />
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer', fontSize: '12px', color: B.muted }}>
              <input type="checkbox" checked={overlay} onChange={(e) => onOverlay(e.target.checked)} />
              {t('v4res.overlay_competitors')}
            </label>
            {excluded.length > 0 && (
              <span style={{ fontSize: '12px', color: B.muted }}>
                {t('v4res.radar_absolute_note')}{' '}
                {excluded.map((r) => getV4Driver(r.driver_key)?.label ?? r.driver_key).join(', ')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ ...card, color: B.muted, fontSize: '13px' }}>{t('v4res.no_radar_data')}</div>
      )}

      {/* Score cards / quick anchors, one per driver. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
        {rows.map((row) => (
          <OverviewCard
            key={row.driver_key}
            row={row}
            view={view}
            insight={insightByDriver.get(row.driver_key) ?? null}
            onOpen={() => onOpenDriver(row.driver_key)}
          />
        ))}
      </div>
    </div>
  )
}

function OverviewCard({
  row,
  view,
  insight,
  onOpen,
}: {
  row: DriverRow
  view: ScoreView
  insight: InsightsResponse['drivers'][number]['insight']
  onOpen: () => void
}) {
  const { t } = useLocale()
  const def = getV4Driver(row.driver_key)
  const hasAbs = def?.hasAbsoluteView ?? false
  const effectiveView: ScoreView = view === 'absolute' && hasAbs ? 'absolute' : 'relative'
  const score = effectiveView === 'absolute' ? row.score_absolute : row.score_relative
  const s = STATUS_STYLE[row.status]

  // Explicit score line (never a bare 100): what the number IS in this view.
  // Relative: "reale 57 (measure) · leader del set" / "… · 74% del leader".
  // Absolute: "measure · n° 2 di 3" (or "Nel set: leader").
  const clientRank = row.sites.find((x) => x.site_ref === 'client')?.rank ?? null
  const measureKey = MEASURE_LABEL_KEY[row.driver_key]
  const measureLabel = measureKey ? t(measureKey) : row.driver_key
  const scoreLine =
    effectiveView === 'absolute'
      ? `${t('v4res.abs_label')} · ${
          clientRank === 1
            ? t('v4res.in_set_leader')
            : clientRank !== null
              ? fill(t('v4res.in_set_rank'), { rank: clientRank, n: row.sites.length })
              : measureLabel
        }`
      : [
          `${t('v4res.ov_real_prefix')} ${fmt(row.raw_value)} (${measureLabel})`,
          clientRank === 1
            ? t('v4res.ov_leader')
            : score !== null && score !== undefined
              ? fill(t('v4res.ov_pct'), { pct: Math.round(Number(score)) })
              : null,
        ]
          .filter(Boolean)
          .join(' · ')

  const summarySnippet = (() => {
    if (insight?.status === 'done') {
      const c = insight.output?.commento_relative ?? insight.output?.commento_absolute
      if (typeof c === 'string' && c.trim() !== '') return firstSentence(c)
    }
    if (row.comment_relative) return firstSentence(row.comment_relative)
    return null
  })()

  return (
    <div
      style={{
        ...card,
        padding: '16px 18px',
        borderColor: row.status === 'error' ? `${B.error}40` : row.status === 'needs_decision' ? `${B.warning}60` : B.border,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: B.ink }}>{def?.label ?? row.driver_key}</span>
        <span style={pill(s.color)}>{s.label}</span>
        {row.edited && <span style={pill(B.warning)}>{t('v4res.edited_badge')}</span>}
      </div>

      <div style={{ display: 'flex', gap: '14px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span
          style={{ fontSize: '28px', fontWeight: 700, color: scoreColor(score ?? null), cursor: 'help' }}
          title={t('v4res.formula_note')}
        >
          {fmt(score)}
        </span>
        <span style={pill(B.muted)}>
          {t(def?.family === 'business' ? 'v4res.family_business' : 'v4res.family_development')}
        </span>
      </div>
      {/* One explicit line under the number: what it is, and the real measure. */}
      <div style={{ fontSize: '11px', color: B.muted }} title={t('v4res.formula_note')}>
        {scoreLine}
      </div>

      {row.status === 'error' && row.error && (
        <div style={{ fontSize: '12px', color: B.error, lineHeight: 1.5 }}>{clipText(row.error, 160)}</div>
      )}

      {summarySnippet && row.status === 'done' && (
        <div style={{ fontSize: '12px', color: B.muted, lineHeight: 1.5 }}>{summarySnippet}</div>
      )}

      <button type="button" onClick={onOpen} style={{ ...ghostButton, alignSelf: 'flex-start' }}>
        {row.status === 'needs_decision' ? t('v4res.resolve') : t('v4res.open_tab')}
      </button>
    </div>
  )
}

function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]{10,200}[.!?]/)
  return m ? m[0] : clipText(text, 160)
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
