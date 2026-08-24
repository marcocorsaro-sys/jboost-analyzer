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
import type { CSSProperties } from 'react'
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
import type { EditsResponse, InsightsResponse, SiteMeta, SetIndex } from './results-shared'
import {
  card,
  mutedLabel,
  pill,
  primaryButton,
  ghostButton,
  scoreColor,
  relBandColor,
  fill,
  MEASURE_LABEL_KEY,
  computeSetIndex,
  driverDotColor,
  heroBand,
  heroDrop,
  tabBar,
  tabItem,
  statusDot,
  miniBarTrack,
  miniBarFill,
  dashedCard,
  sectionTitle,
} from './results-shared'
import { B } from '@/lib/brand'

// recharts radar reused from V1, in its own lazy chunk (V1 pattern).
const SpiderChart = nextDynamic(() => import('@/components/analyzer/SpiderChart'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 444, background: B.surface, borderRadius: B.radius.card, border: `1px solid ${B.border}` }} aria-hidden />
  ),
})

interface V4StatusResponse extends StatusResponse {
  domain?: string | null
  brandName?: string | null
  /** Client tied to this audit (promotion or wizard pick), null = prospect. */
  clientId?: string | null
  /** Header meta (industry · country · REF_DATE) — setup columns, read-only. */
  industryPreset?: string | null
  country?: string | null
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

  // The active tab lives in ?tab= so refresh and shared links land on the
  // same tab. Read AFTER mount (no SSR/hydration mismatch: the server always
  // renders 'overview'); written with history.replaceState (no router
  // navigation, no re-render loop, no extra history entries).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab')
      if (q) setActiveTab(q)
    } catch {
      /* URL APIs unavailable: keep the default tab */
    }
  }, [])

  const selectTab = useCallback((key: TabKey) => {
    setActiveTab(key)
    try {
      const url = new URL(window.location.href)
      if (key === 'overview') url.searchParams.delete('tab')
      else url.searchParams.set('tab', key)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      /* the tab still switches in-page even if the URL cannot be updated */
    }
  }, [])
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

  // "Rilancia" on a single errored driver card (Overview): same retry route
  // as DriverPanel, scoped to one driver. No force: the row is in error.
  const [cardRetrying, setCardRetrying] = useState<string | null>(null)
  const retryDriver = useCallback(
    async (driverKey: string) => {
      setCardRetrying(driverKey)
      try {
        await fetch(`/api/v4/analyses/${analysisId}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driver: driverKey }),
        })
        await loadStatus()
      } catch {
        /* the card keeps showing the error; the header retry stays available */
      } finally {
        setCardRetrying(null)
      }
    },
    [analysisId, loadStatus],
  )

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

  // Per-site LEADER-INDEX (hero band + comparison table): mean of the
  // non-null relative scores across done drivers, nulls excluded — the same
  // aggregate as scoreSet().overall and lib/v4/audits.computeOverallScore.
  const setIndex: SetIndex = useMemo(() => computeSetIndex(enabledRows), [enabledRows])

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
          fontSize: '15px',
        }}
      >
        {loadError}
      </div>
    )
  }

  if (!status) {
    return <div style={{ color: B.muted, fontSize: '16px' }}>{t('v4res.loading')}</div>
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

  // A ?tab= pointing to a disabled/unknown driver falls back to Overview.
  const currentTab: TabKey = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'overview'

  // Header subline data (mockup): competitor names + industry · country · date.
  const competitorNames = sites.filter((s) => !s.is_client).map((s) => s.name)
  const headerMeta = [status.industryPreset, status.country, status.refDate]
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .join(' · ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ------------------------------------------------------- header ---
          Mockup pagehead: H1 dominio, sottoriga "vs competitor" + chip stato
          driver + meta (industry · country · REF_DATE); azioni a destra. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
        <div>
          <div style={mutedLabel}>{t('v4res.title')}</div>
          <h1
            style={{
              margin: '6px 0 0 0',
              fontSize: '36px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: B.ink,
            }}
          >
            {status.domain ?? analysisId}
          </h1>
          <div
            style={{
              marginTop: '10px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: '15px',
              color: B.muted,
            }}
          >
            {competitorNames.length > 0 && (
              <span>
                {t('v4res.head_vs')}{' '}
                {competitorNames.map((n, i) => (
                  <span key={n}>
                    <b style={{ color: B.ink, fontWeight: 650 }}>{n}</b>
                    {i < competitorNames.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </span>
            )}
            <span style={pill(B.success)}>{fill(t('v4res.head_measured'), { n: progress.done })}</span>
            {progress.needs_decision > 0 && (
              <span style={pill(B.warning)}>
                {fill(t('v4res.head_waiting'), { n: progress.needs_decision })}
              </span>
            )}
            {progress.error > 0 && (
              <span style={pill(B.error)}>{fill(t('v4res.head_errors'), { n: progress.error })}</span>
            )}
            <span style={pill(auditState.color)}>{t(auditState.key as Parameters<typeof t>[0])}</span>
            {/* Promotion — the audit (prospect) becomes a client, or shows the
                client it already belongs to. Same island as /audits. */}
            <SwitchToClientButton
              analysisId={analysisId}
              auditName={status.brandName || status.domain || analysisId}
              clientId={status.clientId ?? null}
            />
            {headerMeta && <span>{headerMeta}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
            <ControllerChip
              data={controller}
              open={controllerOpen}
              onToggle={() => setControllerOpen((v) => !v)}
            />
            <button
              type="button"
              onClick={generateInsights}
              disabled={insightsRunning}
              style={primaryButton(!insightsRunning)}
            >
              {insightsRunning ? t('v4res.gen_insights_running') : t('v4res.gen_insights')}
            </button>
            <button
              type="button"
              onClick={() => setPublishOpen(true)}
              disabled={progress.pending > 0}
              style={primaryButton(progress.pending === 0)}
              title={progress.pending > 0 ? t('v4res.publish_blocked_running') : undefined}
            >
              {t('v4res.save_publish')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Absolute / Relative toggle (default Relative — sheet 6 v5). */}
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
            <span style={{ fontSize: '14px', color: drafts > 0 ? B.warning : B.muted }}>
              {drafts > 0 ? `${drafts} ${t('v4res.drafts_pending')}` : t('v4res.no_drafts')}
            </span>
          </div>
          {retryNote && <span style={{ fontSize: '14px', color: B.warning }}>{retryNote}</span>}
        </div>
      </div>

      {/* ------------------------------------------------ hero band -------
          LEADER-INDEX del cliente + classifica del set (mockup .hero). */}
      <HeroBand setIndex={setIndex} totalEnabled={enabledRows.length} sites={sites} />

      {/* Controller findings panel (inline, toggled by the header chip). */}
      {controllerOpen && (
        <ControllerPanel
          data={controller}
          loading={controllerLoading}
          error={controllerError}
          onRecheck={loadController}
        />
      )}

      {/* ------------------------------------------------------- tab bar --
          Mockup .tabs: one white rail, active tab solid navy, status dot per
          driver (verde ok, rosso critico, ambra decisione, grigio in attesa).
          Overview e le tab non-driver restano senza pallino. */}
      <div style={tabBar}>
        {tabs.map((tab) => {
          const row = enabledRows.find((d) => d.driver_key === tab.key)
          const active = currentTab === tab.key
          return (
            <button key={tab.key} type="button" onClick={() => selectTab(tab.key)} style={tabItem(active)}>
              {row && <span style={statusDot(driverDotColor(row))} />}
              {tab.label}
              {row?.edited && <span style={{ color: active ? B.onPrimary : B.warning }}>✎</span>}
            </button>
          )
        })}
      </div>

      {genError && (
        <div style={{ fontSize: '14px', color: B.error }}>
          {t('v4res.insights_error')}: {genError}
        </div>
      )}
      {insights?.insightsError && !insightsRunning && (
        <div style={{ fontSize: '14px', color: B.warning }}>{insights.insightsError}</div>
      )}

      {/* ------------------------------------------------------- content -- */}
      {currentTab === 'overview' && (
        <OverviewTab
          rows={enabledRows}
          sites={sites}
          view={view}
          overlay={overlay}
          onOverlay={setOverlay}
          progress={progress}
          starting={starting}
          onStartPending={startPending}
          onOpenDriver={(key) => selectTab(key)}
          setIndex={setIndex}
          onRetryDriver={retryDriver}
          cardRetrying={cardRetrying}
        />
      )}

      {currentTab === 'summary' && (
        <ExecutiveSummaryTab
          record={insights?.executiveSummary ?? null}
          insightsRunning={insightsRunning}
          onGenerate={generateInsights}
        />
      )}

      {currentTab === 'output' && (
        <OutputPreviewTab
          analysisId={analysisId}
          anyDriverDone={enabledRows.some((r) => r.status === 'done')}
        />
      )}

      {enabledRows.map(
        (row) =>
          currentTab === row.driver_key && (
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
// Hero band — LEADER-INDEX del cliente + classifica del set (mockup .hero).
// ---------------------------------------------------------------------------

function HeroBand({
  setIndex,
  totalEnabled,
  sites,
}: {
  setIndex: SetIndex
  totalEnabled: number
  sites: SiteMeta[]
}) {
  const { t } = useLocale()
  const ranked = setIndex.entries.filter((e) => e.index !== null)
  // Nothing measured yet: no band (the cards and the poll note carry the state).
  if (ranked.length === 0) return null

  const client = setIndex.entries.find((e) => e.site_ref === 'client') ?? null
  const leader = ranked[0]
  const top = leader.index ?? 100
  const nameOf = (ref: string, domain: string) =>
    sites.find((s) => s.site_ref === ref)?.name ?? domain
  const leaderIsClient = leader.site_ref === 'client'

  return (
    <div style={heroBand}>
      <div style={heroDrop} aria-hidden />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'rgba(255, 255, 255, 0.65)',
            marginBottom: '6px',
          }}
        >
          {t('v4res.hero_label')}
        </div>
        <div
          style={{
            ...B.type.num,
            fontSize: '84px',
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: '-0.03em',
          }}
        >
          {fmt(client?.index ?? null)}
          <small style={{ fontSize: '26px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.55)', letterSpacing: 0 }}>
            /100
          </small>
        </div>
        {/* Con meno di 3 driver misurati l'indice è dichiarato parziale. */}
        {setIndex.measuredDrivers < 3 && (
          <div style={{ marginTop: '8px', fontSize: '13px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.65)' }}>
            {fill(t('v4res.hero_partial'), { n: setIndex.measuredDrivers, m: totalEnabled })}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: '15px',
          color: 'rgba(255, 255, 255, 0.75)',
          maxWidth: '360px',
          lineHeight: 1.55,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {t('v4res.hero_expl')}{' '}
        {leaderIsClient ? (
          <b style={{ color: B.onPrimary }}>{t('v4res.hero_ref_self')}</b>
        ) : (
          <>
            {t('v4res.hero_ref')} <b style={{ color: B.onPrimary }}>{nameOf(leader.site_ref, leader.domain)}</b>.
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '280px', position: 'relative', zIndex: 1 }}>
        {setIndex.entries.map((e) => {
          const isMe = e.site_ref === 'client'
          const width = e.index !== null && top > 0 ? (e.index / top) * 100 : 0
          return (
            <div
              key={e.site_ref}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 110px 1fr 44px',
                gap: '10px',
                alignItems: 'center',
                fontSize: '15px',
                ...B.type.num,
              }}
            >
              <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontWeight: 700 }}>{e.rank ?? '—'}</span>
              <span style={{ fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nameOf(e.site_ref, e.domain)}
                {isMe && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      background: B.accentRed,
                      color: B.onPrimary,
                      borderRadius: '4px',
                      padding: '2px 5px',
                      marginLeft: '8px',
                      verticalAlign: '2px',
                    }}
                  >
                    {t('v4res.hero_you')}
                  </span>
                )}
              </span>
              <span style={{ height: '8px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.15)', overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', borderRadius: '999px', background: B.onPrimary, width: `${width}%` }} />
              </span>
              <span style={{ textAlign: 'right', fontWeight: 750 }}>{fmt(e.index)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview tab: driver cards (mockup .grid) + tabella confronto + radar.
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
  setIndex,
  onRetryDriver,
  cardRetrying,
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
  setIndex: SetIndex
  onRetryDriver: (key: string) => void
  cardRetrying: string | null
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {progress.total === 0 && (
        <div style={{ ...card, color: B.muted, fontSize: '16px' }}>{t('v4res.no_jobs')}</div>
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
        <div style={{ fontSize: '14px', color: B.muted }}>{t('v4res.autorefresh')}</div>
      )}

      {/* Driver cards, one per driver (mockup .grid): click = apri la tab. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
        {rows.map((row) => (
          <OverviewCard
            key={row.driver_key}
            row={row}
            view={view}
            sites={sites}
            onOpen={() => onOpenDriver(row.driver_key)}
            onRetry={() => onRetryDriver(row.driver_key)}
            retrying={cardRetrying === row.driver_key}
          />
        ))}
      </div>

      {/* Confronto nel set: righe = siti, colonne = driver misurati + Index. */}
      <ComparisonPanel rows={rows} sites={sites} setIndex={setIndex} />

      {/* Panoramic radar (Bibbia sheet 6), sotto la tabella di confronto. */}
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
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer', fontSize: '14px', color: B.muted }}>
              <input type="checkbox" checked={overlay} onChange={(e) => onOverlay(e.target.checked)} />
              {t('v4res.overlay_competitors')}
            </label>
            {excluded.length > 0 && (
              <span style={{ fontSize: '14px', color: B.muted }}>
                {t('v4res.radar_absolute_note')}{' '}
                {excluded.map((r) => getV4Driver(r.driver_key)?.label ?? r.driver_key).join(', ')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ ...card, color: B.muted, fontSize: '15px' }}>{t('v4res.no_radar_data')}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confronto nel set (mockup .panel): leader col badge, riga cliente
// evidenziata, numeri 22px right-aligned, colori semantici sugli estremi.
// ---------------------------------------------------------------------------

const compareTh = (align: 'left' | 'right'): CSSProperties => ({
  ...B.type.label,
  color: B.muted,
  textAlign: align,
  padding: '0 16px 12px',
  borderBottom: `1px solid ${B.border}`,
  whiteSpace: 'nowrap',
})

const compareTd: CSSProperties = {
  padding: '16px',
  fontSize: '15px',
  borderBottom: `1px solid ${B.surface}`,
}

function ComparisonPanel({
  rows,
  sites,
  setIndex,
}: {
  rows: DriverRow[]
  sites: SiteMeta[]
  setIndex: SetIndex
}) {
  const { t } = useLocale()
  // Columns: only drivers with at least one measured relative score.
  const measured = rows.filter(
    (r) => r.status === 'done' && r.sites.some((s) => typeof s.score_relative === 'number'),
  )
  if (measured.length === 0 || setIndex.entries.length === 0) return null

  const nameOf = (ref: string, domain: string) =>
    sites.find((m) => m.site_ref === ref)?.name ?? domain

  // Same precedence as computeSetIndex: the client's row-level score wins
  // (analyst edits), competitors use the per-site normalized score.
  const scoreFor = (row: DriverRow, ref: string): number | null => {
    const s = row.sites.find((x) => x.site_ref === ref)
    const v =
      ref === 'client'
        ? (row.score_relative ?? s?.score_relative ?? null)
        : (s?.score_relative ?? null)
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  return (
    <div style={card}>
      <h2 style={{ ...sectionTitle, margin: '0 0 4px 0' }}>{t('v4res.compare_title')}</h2>
      <p style={{ fontSize: '15px', color: B.muted, margin: '0 0 22px 0', maxWidth: '75ch' }}>
        {t('v4res.compare_desc')}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...B.type.num }}>
          <thead>
            <tr>
              <th style={compareTh('left')}>{t('v4res.compare_site')}</th>
              {measured.map((r) => (
                <th key={r.driver_key} style={compareTh('right')}>
                  {getV4Driver(r.driver_key)?.label ?? r.driver_key}
                </th>
              ))}
              <th style={compareTh('right')}>{t('v4res.compare_index')}</th>
            </tr>
          </thead>
          <tbody>
            {setIndex.entries.map((e, i) => {
              const isMe = e.site_ref === 'client'
              const last = i === setIndex.entries.length - 1
              return (
                <tr
                  key={e.site_ref}
                  style={isMe ? { background: `linear-gradient(90deg, ${B.primarySoft}, transparent 70%)` } : undefined}
                >
                  <td
                    style={{
                      ...compareTd,
                      ...(last ? { borderBottom: 0 } : {}),
                      ...(isMe ? { borderLeft: `3px solid ${B.primary}`, borderRadius: '2px' } : {}),
                    }}
                  >
                    <span style={{ fontWeight: 650, color: B.ink }}>{nameOf(e.site_ref, e.domain)}</span>
                    {e.rank === 1 && (
                      <span style={{ ...pill(B.success), marginLeft: '8px', fontSize: '12px', padding: '3px 8px' }}>
                        {t('v4res.leader')}
                      </span>
                    )}
                  </td>
                  {measured.map((r) => {
                    const v = scoreFor(r, e.site_ref)
                    const rounded = v === null ? null : Math.round(v)
                    // Semantic colour only on the client's extremes: 100 =
                    // leader (green), < 30 critical (red), else plain ink.
                    const color =
                      isMe && rounded !== null
                        ? rounded >= 100
                          ? B.success
                          : rounded < 30
                            ? B.error
                            : B.ink
                        : B.ink
                    return (
                      <td
                        key={r.driver_key}
                        style={{
                          ...compareTd,
                          ...(last ? { borderBottom: 0 } : {}),
                          textAlign: 'right',
                          fontSize: '22px',
                          fontWeight: 750,
                          color,
                        }}
                      >
                        {fmt(rounded)}
                      </td>
                    )
                  })}
                  <td
                    style={{
                      ...compareTd,
                      ...(last ? { borderBottom: 0 } : {}),
                      textAlign: 'right',
                      fontSize: '22px',
                      fontWeight: 750,
                      color: B.primary,
                    }}
                  >
                    {fmt(e.index)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Driver card (mockup .card): nome uppercase, chip stato, score semantico,
// riga misura reale, minibar. needs_decision = card tratteggiata con CTA;
// error = bordo rosso + Rilancia. Click sulla card = apri la tab del driver.
// ---------------------------------------------------------------------------

function OverviewCard({
  row,
  view,
  sites,
  onOpen,
  onRetry,
  retrying,
}: {
  row: DriverRow
  view: ScoreView
  sites: SiteMeta[]
  onOpen: () => void
  onRetry: () => void
  retrying: boolean
}) {
  const { t } = useLocale()
  const def = getV4Driver(row.driver_key)
  const name = def?.label ?? row.driver_key
  const measureKey = MEASURE_LABEL_KEY[row.driver_key]
  const measureLabel = measureKey ? t(measureKey) : row.driver_key

  const openOnKey = (e: { key: string }) => {
    if (e.key === 'Enter' || e.key === ' ') onOpen()
  }

  // ---- needs_decision: card tratteggiata con invito + CTA -----------------
  if (row.status === 'needs_decision') {
    const request = (row.decision_request ?? {}) as { message?: string }
    const copy =
      row.driver_key === 'ai_visibility'
        ? {
            title: t('v4res.card_wait_ai_title'),
            body: t('v4res.card_wait_ai_body'),
            cta: t('v4res.card_wait_ai_cta'),
          }
        : row.driver_key === 'content'
          ? {
              title: t('v4res.card_wait_content_title'),
              body: t('v4res.card_wait_content_body'),
              cta: t('v4res.card_wait_content_cta'),
            }
          : {
              title: t('v4res.card_wait_generic_title'),
              body: typeof request.message === 'string' ? clipText(request.message, 140) : '',
              cta: t('v4res.card_wait_generic_cta'),
            }
    return (
      <div
        className="jk-card-hover"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={openOnKey}
        style={{
          ...dashedCard,
          borderColor: `${B.warning}70`,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span style={mutedLabel}>{name}</span>
        <div style={{ fontSize: '22px', fontWeight: 700, color: B.warning, lineHeight: 1.3, marginTop: '12px' }}>
          {copy.title}
        </div>
        {copy.body && (
          <div style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5, marginTop: '6px' }}>{copy.body}</div>
        )}
        <span style={{ marginTop: '12px', fontSize: '14px', fontWeight: 700, color: B.primary }}>{copy.cta}</span>
      </div>
    )
  }

  // ---- error: bordo rosso, motivo breve, CTA Rilancia ---------------------
  if (row.status === 'error') {
    return (
      <div
        className="jk-card-hover"
        style={{ ...card, borderColor: `${B.error}66`, display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span style={mutedLabel}>{name}</span>
          <span style={pill(B.error)}>{STATUS_STYLE.error.label}</span>
        </div>
        <div style={{ fontSize: '14px', color: B.error, lineHeight: 1.5 }}>
          {clipText(row.error ?? '—', 140)}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            style={{ ...ghostButton, borderColor: `${B.error}66`, color: retrying ? B.muted : B.error }}
            title={t('v4res.retry_hint')}
          >
            {retrying ? t('v4res.retrying') : t('v4res.retry')}
          </button>
          <button type="button" onClick={onOpen} style={ghostButton}>
            {t('v4res.open_tab')}
          </button>
        </div>
      </div>
    )
  }

  // ---- queued / running ---------------------------------------------------
  if (row.status === 'queued' || row.status === 'running') {
    const s = STATUS_STYLE[row.status]
    return (
      <div
        className="jk-card-hover"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={openOnKey}
        style={{ ...card, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span style={mutedLabel}>{name}</span>
          <span style={pill(s.color)}>{s.label}</span>
        </div>
        <div style={{ fontSize: '14px', color: B.muted, lineHeight: 1.5 }}>{t('v4res.card_queued_note')}</div>
      </div>
    )
  }

  // ---- done: score semantico + misura reale + minibar ---------------------
  const hasAbs = def?.hasAbsoluteView ?? false
  const effectiveView: ScoreView = view === 'absolute' && hasAbs ? 'absolute' : 'relative'
  const score = effectiveView === 'absolute' ? row.score_absolute : row.score_relative
  const color = effectiveView === 'relative' ? relBandColor(score) : scoreColor(score)
  const clientRank = row.sites.find((x) => x.site_ref === 'client')?.rank ?? null
  const leaderSite = row.sites.find((s) => s.rank === 1 && s.site_ref !== 'client') ?? null
  const leaderName = leaderSite
    ? (sites.find((m) => m.site_ref === leaderSite.site_ref)?.name ?? leaderSite.domain)
    : null

  return (
    <div
      className="jk-card-hover"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={openOnKey}
      style={{ ...card, cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={mutedLabel}>{name}</span>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {row.driver_key === 'discoverability' && row.tier_used && (
            <span style={pill(B.primary)}>
              {t('v4res.tier_label')} {row.tier_used}
            </span>
          )}
          {row.edited && <span style={pill(B.warning)}>{t('v4res.edited_badge')}</span>}
          <span style={pill(B.success)}>{STATUS_STYLE.done.label}</span>
        </span>
      </div>

      <div
        style={{
          ...B.type.num,
          fontSize: '52px',
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color,
          cursor: 'help',
        }}
        title={t('v4res.formula_note')}
      >
        {fmt(score)}
      </div>

      {/* Misura reale (mai un 100 relativo senza il suo raw) + leader del set. */}
      <div style={{ fontSize: '14px', color: B.muted, marginTop: '8px', lineHeight: 1.5 }}>
        {clientRank === 1 ? (
          <>
            {t('v4res.card_leader_self')} ·{' '}
            <b style={{ color: B.ink, fontWeight: 650 }}>{fmt(row.raw_value)}</b> ({measureLabel})
          </>
        ) : (
          <>
            {t('v4res.real_measure')}:{' '}
            <b style={{ color: B.ink, fontWeight: 650 }}>{fmt(row.raw_value)}</b> ({measureLabel})
            {leaderSite && leaderName ? (
              <>
                {' '}
                · {t('v4res.leader')} {leaderName} {fmt(leaderSite.raw)}
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Minibar proporzionale, sempre sul relativo (proporzione vs leader). */}
      <div style={{ marginTop: 'auto' }}>
        <div style={miniBarTrack}>
          <i style={miniBarFill(Number(row.score_relative ?? 0), relBandColor(row.score_relative))} />
        </div>
      </div>
    </div>
  )
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
